// Saves the tender documents for every tender being bid on, so they can be read offline and the
// tender's own forms can go into the bid pack. PDFs are kept as they are; DOC and DOCX are
// converted with LibreOffice when it's installed; MSG (Outlook email) files are kept for the user
// to open. Reading them with Claude is phase 3, still to come.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { DATA_DIR, db, schema } from '../../src/lib/db.ts';

const run = promisify(execFile);
type Log = (msg: string) => void;

/** Failed downloads wait this long before another try, so a dead link isn't hammered. */
const RETRY_MS = 30 * 60 * 1000;
const failedAt = new Map<number, number>();

const SOFFICE = ['/Applications/LibreOffice.app/Contents/MacOS/soffice', '/opt/homebrew/bin/soffice', '/usr/local/bin/soffice', '/usr/bin/soffice']
  .find((p) => existsSync(p)) ?? null;

export const canConvertWord = () => SOFFICE !== null;

const safe = (s: string) => s.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'document';

async function pageCount(file: string): Promise<number | null> {
  try {
    const pdf = await PDFDocument.load(readFileSync(file), { ignoreEncryption: true, updateMetadata: false });
    return pdf.getPageCount();
  } catch {
    return null;
  }
}

async function toPdf(file: string, outDir: string, log: Log): Promise<string | null> {
  if (!SOFFICE) return null;
  try {
    await run(SOFFICE, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, file], { timeout: 120_000 });
    const pdf = join(outDir, `${basename(file, extname(file))}.pdf`);
    return existsSync(pdf) ? pdf : null;
  } catch (err) {
    log(`documents: converting ${basename(file)} failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/** Downloads whatever isn't saved yet for tenders with a bid. Quick when there's nothing to do. */
export async function saveTenderDocuments(log: Log) {
  const bidOcids = db.select({ ocid: schema.bids.ocid }).from(schema.bids);
  const pending = (await db.select().from(schema.tenderDocuments)
    .where(and(inArray(schema.tenderDocuments.ocid, bidOcids), isNull(schema.tenderDocuments.downloadedAt))))
    .filter((d) => d.url && Date.now() - (failedAt.get(d.id) ?? 0) > RETRY_MS);
  for (const d of pending) {
    const dir = join(DATA_DIR, 'tenders', d.ocid, 'docs');
    mkdirSync(dir, { recursive: true });
    const ext = d.format ? `.${d.format}` : extname(d.title ?? '') || '.bin';
    const name = `${d.id}-${safe(basename(d.title ?? 'document', extname(d.title ?? '')))}${ext}`;
    const file = join(dir, name);
    const t0 = Date.now();
    try {
      const res = await fetch(d.url!, { signal: AbortSignal.timeout(120_000) });
      log(`GET ${d.url} -> ${res.status} in ${Date.now() - t0}ms`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    } catch (err) {
      failedAt.set(d.id, Date.now());
      log(`documents: couldn’t download “${d.title}”: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    let pdf: string | null = null;
    if (d.format === 'pdf') pdf = file;
    else if (d.format === 'doc' || d.format === 'docx' || d.format === 'rtf') pdf = await toPdf(file, dir, log);
    const rel = (p: string | null) => (p ? relative(DATA_DIR, p) : null);
    await db.update(schema.tenderDocuments).set({
      localPath: rel(file), pdfPath: rel(pdf), pages: pdf ? await pageCount(pdf) : null, downloadedAt: new Date(),
    }).where(eq(schema.tenderDocuments.id, d.id));
    log(`documents: saved “${d.title}”${pdf ? '' : d.format === 'msg' ? ' (Outlook email, open it yourself)' : SOFFICE ? '' : ' (not converted: LibreOffice isn’t installed)'}`);
  }
}

/** Tenders whose Word documents were saved before LibreOffice was installed: convert them now. */
export async function convertWaitingWordFiles(log: Log) {
  if (!SOFFICE) return;
  const waiting = await db.select().from(schema.tenderDocuments)
    .where(and(isNull(schema.tenderDocuments.pdfPath), inArray(schema.tenderDocuments.format, ['doc', 'docx', 'rtf'])));
  for (const d of waiting) {
    if (!d.localPath) continue;
    const file = join(DATA_DIR, d.localPath);
    if (!existsSync(file)) continue;
    const pdf = await toPdf(file, join(file, '..'), log);
    if (!pdf) continue;
    await db.update(schema.tenderDocuments).set({ pdfPath: relative(DATA_DIR, pdf), pages: await pageCount(pdf) }).where(eq(schema.tenderDocuments.id, d.id));
  }
}

