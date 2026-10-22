// The eTenders OCDS API client, and parsing a release into the fields we store.
//
// Some releases on eTenders are broken: the API can't serialise them, and any page that contains
// one answers HTTP 500 (seen in October 2026, e.g. a run of about 20 in one day's window). Paging
// carries on past them: a failed page is fetched one release at a time (PageSize=1, where the page
// number is the position in the window), the unreadable positions are counted and skipped, and
// paging resumes after it. The end of a window is a short or empty page, never a 500.
import { fromSast } from './dates.ts';

const BASE = 'https://ocds-api.etenders.gov.za/api/OCDSReleases';
// The docs suggest 20 or less; it also keeps the cost of a page with a broken release small.
const PAGE_SIZE = 20;
const TIMEOUT_MS = 60_000;
const MAX_TRIES = 5;

export type Log = (msg: string) => void;

export interface Release {
  ocid: string;
  date?: string;
  tender: {
    id?: string;
    title?: string;
    status?: string;
    mainProcurementCategory?: string;
    description?: string;
    documents?: { id?: string; title?: string; url?: string; format?: string; datePublished?: string }[];
    tenderPeriod?: { startDate?: string; endDate?: string };
    procuringEntity?: { id?: string; name?: string };
    procurementMethodDetails?: string;
  };
  buyer?: { id?: string; name?: string };
}

class HttpError extends Error {
  status: number;
  constructor(status: number, url: string) {
    super(`HTTP ${status} from ${url}`);
    this.status = status;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One GET, logged. Throws HttpError for a non-2xx answer. */
async function getJson(url: string, log: Log): Promise<unknown> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
    log(`GET ${url} -> ${res.status} in ${Date.now() - t0}ms`);
    if (!res.ok) throw new HttpError(res.status, url);
    return await res.json();
  } catch (err) {
    if (!(err instanceof HttpError)) log(`GET ${url} failed after ${Date.now() - t0}ms: ${err instanceof Error ? err.message : err}`);
    throw err;
  }
}

/**
 * GET with exponential backoff (1s, 2s, 4s, 8s): up to 5 tries for timeouts, network errors and
 * 500s. `serverTries` lowers the tries for a 500 where a broken release is the likely cause.
 */
async function getWithRetry(url: string, log: Log, serverTries = MAX_TRIES): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await getJson(url, log);
    } catch (err) {
      const limit = err instanceof HttpError ? (err.status >= 500 ? serverTries : 1) : MAX_TRIES;
      if (attempt >= limit) throw err;
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
}

const isServerError = (err: unknown) => err instanceof HttpError && err.status >= 500;
const pageUrl = (from: string, to: string, page: number, size: number) =>
  `${BASE}?PageNumber=${page}&PageSize=${size}&dateFrom=${from}&dateTo=${to}`;

type Page = { releases?: Release[]; links?: { next?: string } };

export interface WindowResult {
  releases: Release[];
  /** Positions in the window that eTenders couldn't return. */
  unreadable: number;
}

/**
 * Every release dated from `from` to `to` (YYYY-MM-DD, both inclusive). Throws if the API can't be reached
 * (timeouts, network errors); the caller records the run as failed.
 */
export async function fetchReleases(from: string, to: string, log: Log): Promise<WindowResult> {
  const releases: Release[] = [];
  let unreadable = 0;
  for (let page = 1; ; page++) {
    try {
      const body = (await getWithRetry(pageUrl(from, to, page, PAGE_SIZE), log, 2)) as Page;
      const got = body.releases ?? [];
      releases.push(...got);
      if (got.length < PAGE_SIZE || !body.links?.next) return { releases, unreadable };
      continue;
    } catch (err) {
      if (!isServerError(err)) throw err;
    }
    // The page has a broken release in it: read its positions one at a time.
    const first = (page - 1) * PAGE_SIZE + 1;
    for (let pos = first; pos < first + PAGE_SIZE; pos++) {
      try {
        const got = ((await getWithRetry(pageUrl(from, to, pos, 1), log, 2)) as Page).releases ?? [];
        if (!got.length) return { releases, unreadable };
        releases.push(...got);
      } catch (err) {
        if (!isServerError(err)) throw err;
        unreadable++;
      }
    }
  }
}

/** One release by ocid, or null if eTenders no longer has it. */
export async function fetchRelease(ocid: string, log: Log): Promise<Release | null> {
  try {
    return (await getWithRetry(`${BASE}/release/${encodeURIComponent(ocid)}`, log)) as Release;
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}

// ---------- Parsing ----------

export interface ParsedRelease {
  ocid: string;
  etenderId: string | null;
  reference: string | null;
  description: string | null;
  buyerId: string | null;
  entity: string | null;
  tenderType: 'quotation' | 'open_bid' | null;
  soleSource: boolean;
  cancelled: boolean;
  category: string | null;
  closesAt: Date | null;
  publishedAt: Date | null;
  documents: { sourceId: string; title: string | null; format: string | null; url: string | null }[];
}

/**
 * eTenders times end in "Z" but are South African wall-clock times (closing at 11:00 means 11:00
 * SAST), so the parts are read as SAST.
 */
export function parseSastStamp(s: string | undefined | null): Date | null {
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return null;
  return fromSast(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
}

/** Collapse whitespace; empty becomes null. */
const clean = (s: string | undefined | null) => s?.replace(/\s+/g, ' ').trim() || null;

export function parseRelease(r: Release): ParsedRelease {
  const t = r.tender ?? {};
  const method = (t.procurementMethodDetails ?? '').toLowerCase();
  const status = (t.status ?? '').toLowerCase();
  return {
    ocid: r.ocid,
    etenderId: t.id ?? null,
    reference: clean(t.title),
    description: clean(t.description),
    buyerId: r.buyer?.id ?? t.procuringEntity?.id ?? null,
    entity: clean(r.buyer?.name ?? t.procuringEntity?.name),
    tenderType: method.includes('quotation') ? 'quotation' : method ? 'open_bid' : null,
    soleSource: method.includes('sole source'),
    cancelled: status === 'cancelled' || status === 'withdrawn',
    category: clean(t.mainProcurementCategory),
    closesAt: parseSastStamp(t.tenderPeriod?.endDate),
    publishedAt: parseSastStamp(t.tenderPeriod?.startDate ?? r.date),
    documents: (t.documents ?? [])
      .filter((d) => d.id)
      .map((d) => ({ sourceId: d.id!, title: clean(d.title), format: clean(d.format)?.toLowerCase() ?? null, url: d.url ?? null })),
  };
}
