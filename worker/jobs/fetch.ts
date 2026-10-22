// The eTenders fetch: catch up from the last successful run, re-check open tenders for addenda
// and new closing dates, classify, and record what changed. Every run is written to fetch_runs.
import { desc, eq, isNull } from 'drizzle-orm';
import { db, schema } from '../../src/lib/db.ts';
import { addDays, sastDate } from '../../src/lib/dates.ts';
import { fetchRelease, fetchReleases, parseRelease, type Release } from '../../src/lib/etenders.ts';
import { buyerProvince, classify, readableTitle, tenderProvince } from '../../src/lib/classify.ts';

/** How far back the first run reaches. */
const FIRST_RUN_DAYS = 14;

export interface FetchSummary {
  runId: number;
  fetched: number;
  added: number;
  updated: number;
  skipped: number;
  errors: string[];
  /** Relevant tenders seen for the first time in this run. */
  newOcids: string[];
}

type Log = (msg: string) => void;
type TenderRow = Pick<typeof schema.tenders.$inferSelect, 'ocid' | 'closesAt' | 'cancelled' | 'provinceSource' | 'relevant'>;

/**
 * One fetch run. `recheckAll` re-reads every open relevant tender by ocid (the overnight run);
 * otherwise only tenders being bid on are re-read.
 */
export async function runFetch(log: Log, { recheckAll = false, quiet = false } = {}): Promise<FetchSummary> {
  const now = new Date();
  const httpLog: Log = quiet ? () => {} : log;
  // A run the worker was stopped in the middle of never finishes; close it off as failed.
  await db.update(schema.fetchRuns)
    .set({ finishedAt: now, errorsJson: JSON.stringify({ fatal: true, errors: ['Stopped before it finished.'] }) })
    .where(isNull(schema.fetchRuns.finishedAt));
  const [run] = await db.insert(schema.fetchRuns).values({ startedAt: now }).returning({ id: schema.fetchRuns.id });
  const summary: FetchSummary = { runId: run.id, fetched: 0, added: 0, updated: 0, skipped: 0, errors: [], newOcids: [] };

  // The window, both ends inclusive: from the day before the last successful run's end, so
  // releases published late in the day are caught, to today.
  const last = await lastGoodRun();
  const from = last?.windowTo ? sastDate(addDays(new Date(`${last.windowTo}T12:00:00Z`), -1)) : sastDate(addDays(now, -FIRST_RUN_DAYS));
  const to = sastDate(now);
  await db.update(schema.fetchRuns).set({ windowFrom: from, windowTo: to }).where(eq(schema.fetchRuns.id, run.id));
  log(`fetching releases from ${from} to ${to}`);

  const store = await Store.load();
  let fatal = false;

  // One day at a time, so a failure loses one day, not the whole window.
  for (let day = from; day <= to; day = sastDate(addDays(new Date(`${day}T12:00:00Z`), 1))) {
    try {
      const { releases, unreadable } = await fetchReleases(day, day, httpLog);
      log(`${day}: ${releases.length} releases${unreadable ? `, ${unreadable} unreadable on eTenders` : ''}`);
      if (unreadable) summary.errors.push(`${day}: eTenders couldn’t return ${unreadable} ${unreadable === 1 ? 'release' : 'releases'}.`);
      for (const r of releases) await store.apply(r, now, summary);
    } catch (err) {
      fatal = true;
      summary.errors.push(`${day}: ${err instanceof Error ? err.message : String(err)}`);
      log(`${day}: failed, ${err instanceof Error ? err.message : err}`);
    }
  }

  // Re-read open tenders directly: releases keep their first date, so addenda don't show in new windows.
  const recheck = await store.toRecheck(now, recheckAll);
  if (recheck.length) log(`re-checking ${recheck.length} open ${recheck.length === 1 ? 'tender' : 'tenders'}`);
  for (const ocid of recheck) {
    try {
      const r = await fetchRelease(ocid, httpLog);
      if (r) await store.apply(r, now, summary, true);
    } catch (err) {
      summary.errors.push(`re-check ${ocid}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await db.update(schema.fetchRuns).set({
    finishedAt: new Date(),
    fetched: summary.fetched,
    added: summary.added,
    updated: summary.updated,
    skipped: summary.skipped,
    // A run with a failed day isn't "good", so the next run starts from the same place.
    errorsJson: summary.errors.length ? JSON.stringify({ fatal, errors: summary.errors }) : null,
  }).where(eq(schema.fetchRuns.id, run.id));

  log(`done: ${summary.fetched} fetched, ${summary.added} new relevant, ${summary.updated} updated, ${summary.skipped} skipped${summary.errors.length ? `, ${summary.errors.length} problems` : ''}`);
  return summary;
}

/** The most recent finished run that didn't fail outright. */
async function lastGoodRun() {
  const runs = await db.select().from(schema.fetchRuns).orderBy(desc(schema.fetchRuns.startedAt)).limit(20);
  return runs.find((r) => r.finishedAt && !(r.errorsJson && JSON.parse(r.errorsJson).fatal)) ?? null;
}

/** What's already stored, so each release becomes an insert, an update or nothing. */
class Store {
  tenders: Map<string, TenderRow>;
  docs: Map<string, Set<string>>;
  buyers: Map<string, string | null>;
  bidOcids: Set<string>;

  constructor(tenders: TenderRow[], docs: { ocid: string; sourceId: string | null }[], buyers: { buyerId: string; province: string | null }[], bids: { ocid: string }[]) {
    this.tenders = new Map(tenders.map((t) => [t.ocid, t]));
    this.docs = new Map();
    for (const d of docs) {
      if (!d.sourceId) continue;
      if (!this.docs.has(d.ocid)) this.docs.set(d.ocid, new Set());
      this.docs.get(d.ocid)!.add(d.sourceId);
    }
    this.buyers = new Map(buyers.map((b) => [b.buyerId, b.province]));
    this.bidOcids = new Set(bids.map((b) => b.ocid));
  }

  static async load() {
    const t = schema.tenders;
    const [tenders, docs, buyers, bids] = await Promise.all([
      db.select({ ocid: t.ocid, closesAt: t.closesAt, cancelled: t.cancelled, provinceSource: t.provinceSource, relevant: t.relevant }).from(t),
      db.select({ ocid: schema.tenderDocuments.ocid, sourceId: schema.tenderDocuments.sourceId }).from(schema.tenderDocuments),
      db.select({ buyerId: schema.buyers.buyerId, province: schema.buyers.province }).from(schema.buyers),
      db.select({ ocid: schema.bids.ocid }).from(schema.bids),
    ]);
    return new Store(tenders, docs, buyers, bids);
  }

  async toRecheck(now: Date, all: boolean): Promise<string[]> {
    const open = [...this.tenders.values()].filter((t) => !t.ocid.startsWith('seed-') && !t.cancelled && t.closesAt && t.closesAt > now);
    return open.filter((t) => this.bidOcids.has(t.ocid) || (all && t.relevant)).map((t) => t.ocid);
  }

  /** The buyer's province, adding the buyer on first sight. A confirmed province is the user's. */
  async buyerProvince(id: string | null, name: string | null): Promise<string | null> {
    if (!id) return buyerProvince(name);
    if (this.buyers.has(id)) return this.buyers.get(id)!;
    const province = buyerProvince(name);
    await db.insert(schema.buyers).values({ buyerId: id, name, province }).onConflictDoNothing();
    this.buyers.set(id, province);
    return province;
  }

  async apply(r: Release, now: Date, s: FetchSummary, recheck = false) {
    const p = parseRelease(r);
    if (!recheck) s.fetched++;
    if (p.soleSource) {
      if (!recheck) s.skipped++;
      return;
    }
    const existing = this.tenders.get(p.ocid);
    const bProv = await this.buyerProvince(p.buyerId, p.entity);
    const rawJson = JSON.stringify(r);

    if (!existing) {
      const c = classify(p.description);
      const prov = tenderProvince(bProv, p.description);
      await db.insert(schema.tenders).values({
        ocid: p.ocid, etenderId: p.etenderId, reference: p.reference, title: readableTitle(p.description, p.reference),
        description: p.description, buyerId: p.buyerId, entity: p.entity, province: prov.province, provinceSource: prov.source,
        workType: c.workType, tenderType: p.tenderType, relevant: c.relevant, relevanceReason: c.reason,
        closesAt: p.closesAt, publishedAt: p.publishedAt, firstSeenAt: now, cancelled: p.cancelled, rawJson, updatedAt: now,
      }).onConflictDoNothing();
      await this.addDocs(p.ocid, p.documents);
      this.tenders.set(p.ocid, { ocid: p.ocid, closesAt: p.closesAt, cancelled: p.cancelled, provinceSource: prov.source, relevant: c.relevant });
      if (c.relevant) {
        s.added++;
        s.newOcids.push(p.ocid);
      } else s.skipped++;
      return;
    }

    // Known tender: record what changed, then refresh the eTenders fields. Titles, work type and
    // a confirmed province may have been corrected by the user, so they're left alone.
    const changes: (typeof schema.tenderChanges.$inferInsert)[] = [];
    const tracked = existing.relevant || this.bidOcids.has(p.ocid);
    if (p.closesAt && existing.closesAt && p.closesAt.getTime() !== existing.closesAt.getTime()) {
      changes.push({ ocid: p.ocid, field: 'closes_at', oldValue: existing.closesAt.toISOString(), newValue: p.closesAt.toISOString(), detectedAt: now });
    }
    if (p.cancelled && !existing.cancelled) changes.push({ ocid: p.ocid, field: 'cancelled', oldValue: null, newValue: 'cancelled', detectedAt: now });
    const known = this.docs.get(p.ocid) ?? new Set();
    const added = p.documents.filter((d) => !known.has(d.sourceId));
    if (added.length && known.size) {
      const addendum = added.find((d) => /addend|amend|notice|extension/i.test(d.title ?? ''));
      changes.push({
        ocid: p.ocid, field: 'documents', oldValue: null,
        newValue: added.map((d) => d.title ?? 'Untitled document').join('\n'),
        source: addendum?.title?.replace(/\.(pdf|docx?|msg)$/i, '') ?? null, detectedAt: now,
      });
    }
    const changed = changes.length > 0 || added.length > 0;
    const prov = existing.provinceSource === 'confirmed' ? null : tenderProvince(bProv, p.description);
    await db.update(schema.tenders).set({
      reference: p.reference, description: p.description, entity: p.entity, buyerId: p.buyerId, tenderType: p.tenderType,
      closesAt: p.closesAt, cancelled: p.cancelled, rawJson, updatedAt: now,
      ...(prov ? { province: prov.province, provinceSource: prov.source } : {}),
    }).where(eq(schema.tenders.ocid, p.ocid));
    await this.addDocs(p.ocid, added);
    if (tracked && changes.length) await db.insert(schema.tenderChanges).values(changes);
    this.tenders.set(p.ocid, { ...existing, closesAt: p.closesAt, cancelled: p.cancelled });
    if (changed) s.updated++;
  }

  async addDocs(ocid: string, docs: { sourceId: string; title: string | null; format: string | null; url: string | null }[]) {
    if (!docs.length) return;
    await db.insert(schema.tenderDocuments).values(docs.map((d) => ({ ocid, sourceId: d.sourceId, title: d.title, format: d.format, url: d.url })));
    if (!this.docs.has(ocid)) this.docs.set(ocid, new Set());
    for (const d of docs) this.docs.get(ocid)!.add(d.sourceId);
  }
}

