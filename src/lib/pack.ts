// The bid pack: one PDF in checklist order, with an index page first and page numbers on every
// page. Each checklist item becomes one part:
// - a form: a sheet filled from the profile (and the answers saved on the form screen), followed
//   by the tender's own form pages when the user has pointed at them, or a blank official form
//   from reference/forms/ when there is one;
// - the pricing schedule: a table of the saved lines and totals;
// - a vault document or an upload: the file itself (PDF pages, or an image on a page);
// - anything not ready: a placeholder page saying what's missing, so a draft shows the layout.
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { DATA_DIR } from './db.ts';
import { fmtCloses, fmtDay, fmtDayAt } from './dates.ts';
import { rand, vatOn } from './money.ts';
import { DISCLOSURE_QUESTIONS } from './forms.ts';
import type { BidDocument, Desk, DeskTender } from './desk.ts';

const A4: [number, number] = [595.28, 841.89];
const M = 56; // margin
const INK = rgb(0.055, 0.059, 0.047);
const MUTED = rgb(0.365, 0.38, 0.349);
const FOREST = rgb(0.086, 0.2, 0);
const LINE = rgb(0.85, 0.87, 0.84);

export interface FormSource {
  /** A tender_documents id. */
  docId: number;
  from: number;
  to: number;
}

export interface PackPart {
  doc: BidDocument;
  pdf: PDFDocument;
  pages: number;
  ready: boolean;
  status: string;
  sign: boolean;
}

interface Fonts { regular: PDFFont; bold: PDFFont }

// ---------- Drawing helpers ----------

/** Text that wraps to `width`, from the top of the page down. Returns the next y. */
function para(page: PDFPage, text: string, x: number, y: number, o: { font: PDFFont; size?: number; width?: number; color?: ReturnType<typeof rgb>; leading?: number }): number {
  const size = o.size ?? 10.5;
  const width = o.width ?? A4[0] - 2 * M;
  const leading = o.leading ?? size * 1.4;
  for (const paragraph of clean(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (o.font.widthOfTextAtSize(test, size) > width && line) {
        page.drawText(line, { x, y, size, font: o.font, color: o.color ?? INK });
        y -= leading;
        line = word;
      } else line = test;
    }
    page.drawText(line, { x, y, size, font: o.font, color: o.color ?? INK });
    y -= leading;
  }
  return y;
}

/** Helvetica only covers WinAnsi, so swap typographic characters it can't draw. */
function clean(s: string): string {
  return s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/ /g, ' ').replace(/…/g, '...').replace(/[^\x20-\x7E\n -ÿ]/g, '');
}

function header(page: PDFPage, f: Fonts, title: string, sub: string): number {
  let y = A4[1] - M;
  y = para(page, title, M, y - 8, { font: f.bold, size: 20, color: FOREST, leading: 24 });
  y = para(page, sub, M, y - 2, { font: f.regular, size: 10, color: MUTED });
  page.drawLine({ start: { x: M, y: y - 4 }, end: { x: A4[0] - M, y: y - 4 }, thickness: 0.8, color: LINE });
  return y - 24;
}

function field(page: PDFPage, f: Fonts, label: string, value: string | null | undefined, y: number): number {
  page.drawText(clean(label), { x: M, y, size: 9.5, font: f.regular, color: MUTED });
  const next = para(page, value?.trim() || '-', M + 170, y, { font: f.bold, size: 10.5, width: A4[0] - 2 * M - 170 });
  page.drawLine({ start: { x: M, y: next + 6 }, end: { x: A4[0] - M, y: next + 6 }, thickness: 0.5, color: LINE });
  return next - 8;
}

function signature(page: PDFPage, f: Fonts, y: number): void {
  y = Math.max(y - 20, M + 90);
  para(page, 'Sign here', M, y, { font: f.bold, size: 10.5 });
  const cols: [string, number][] = [['Signature', M], ['Name and capacity', M + 170], ['Date', M + 360]];
  for (const [label, x] of cols) {
    page.drawLine({ start: { x, y: y - 40 }, end: { x: x + 150, y: y - 40 }, thickness: 0.8, color: INK });
    page.drawText(label, { x, y: y - 54, size: 9, font: f.regular, color: MUTED });
  }
}

// ---------- Parts ----------

function sheetIntro(t: DeskTender, extra = ''): string {
  return `${t.title ?? t.reference ?? 'Tender'}. ${t.entity ?? ''}${t.reference ? `, reference ${t.reference}` : ''}.${extra}`;
}

async function withFonts(): Promise<[PDFDocument, Fonts]> {
  const pdf = await PDFDocument.create();
  return [pdf, { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) }];
}

async function formPart(desk: Desk, t: DeskTender, d: BidDocument): Promise<PDFDocument> {
  const [pdf, f] = await withFonts();
  const page = pdf.addPage(A4);
  const P = desk.profile;
  const data = d.formDataJson ? JSON.parse(d.formDataJson) : {};
  let y = header(page, f, d.name, `${sheetIntro(t)} Filled by iTender from your company profile.`);
  const rows: [string, string | null | undefined][] = [
    ['Company name', P?.name], ['Registration number', P?.registrationNumber], ['CSD supplier number', P?.csdNumber],
    ['Tax compliance PIN', P?.taxPin], ['VAT number', P?.vatRegistered ? P?.vatNumber : 'Not VAT-registered'],
    ['Physical address', P?.address], ['Contact person', P?.contactPerson], ['Phone', P?.phone], ['Email', P?.email],
  ];
  for (const [l, v] of rows) y = field(page, f, l, v, y);

  if (d.formType === 'disclosure') {
    y = para(page, 'Declarations', M, y - 14, { font: f.bold, size: 12, color: FOREST }) - 4;
    const answers: boolean[] = data.answers ?? [];
    DISCLOSURE_QUESTIONS.forEach((q, i) => {
      y = field(page, f, `Question ${i + 1}`, `${q} ${answers[i] === undefined ? 'Not answered' : answers[i] ? 'Yes' : 'No'}`, y);
    });
  }
  if (d.formType === 'sbd61') {
    const claims = new Set<number>(data.claims ?? []);
    const max = t.goals.reduce((a, g) => a + (g.points ?? 0), 0);
    const got = t.goals.filter((g) => claims.has(g.id)).reduce((a, g) => a + (g.points ?? 0), 0);
    y = para(page, `Preference points${t.preferenceSystem ? `, ${t.preferenceSystem} system` : ''}`, M, y - 14, { font: f.bold, size: 12, color: FOREST }) - 4;
    if (!t.goals.length) y = para(page, 'No specific goals were entered from the tender document.', M, y, { font: f.regular });
    for (const g of t.goals) y = field(page, f, `${g.points ?? 0} points`, `${g.name}: ${claims.has(g.id) ? 'claimed' : 'not claimed'}`, y);
    if (t.goals.length) y = field(page, f, 'Points claimed', `${got} of ${max}`, y);
  }
  y = para(page, 'Copy these details onto the tender’s own form if it has one, and sign both.', M, y - 10, { font: f.regular, size: 9.5, color: MUTED });
  if (d.needsSignature) signature(page, f, y);
  return pdf;
}

async function pricingPart(desk: Desk, t: DeskTender, d: BidDocument): Promise<PDFDocument> {
  const [pdf, f] = await withFonts();
  const page = pdf.addPage(A4);
  const vat = desk.vatRegistered();
  let y = header(page, f, d.name, `${sheetIntro(t)} ${vat ? 'Prices include VAT at 15%.' : 'The bidder is not VAT-registered, so no VAT is added.'}`);
  const cols = { item: M, qty: 360, unit: 420, total: A4[0] - M };
  const right = (s: string, x: number, yy: number, font: PDFFont) => page.drawText(s, { x: x - font.widthOfTextAtSize(s, 10.5), y: yy, size: 10.5, font, color: INK });
  page.drawText('Item', { x: cols.item, y, size: 9.5, font: f.regular, color: MUTED });
  right('Qty', cols.qty + 30, y, f.regular);
  right('Unit price', cols.unit + 50, y, f.regular);
  right('Amount', cols.total, y, f.regular);
  y -= 18;
  let sub = 0;
  for (const l of t.bid?.lines ?? []) {
    const amount = l.quantity * (l.unitPriceCents ?? 0);
    sub += amount;
    const next = para(page, l.label, cols.item, y, { font: f.regular, width: 290 });
    right(String(l.quantity), cols.qty + 30, y, f.regular);
    right(l.unitPriceCents === null ? '-' : rand(l.unitPriceCents).replace(/ /g, ' '), cols.unit + 50, y, f.regular);
    right(rand(amount).replace(/ /g, ' '), cols.total, y, f.regular);
    page.drawLine({ start: { x: M, y: next + 6 }, end: { x: A4[0] - M, y: next + 6 }, thickness: 0.5, color: LINE });
    y = next - 8;
  }
  const totals: [string, number][] = [['Subtotal', sub], ...(vat ? [['VAT at 15%', vatOn(sub)] as [string, number]] : []), ['Total', sub + (vat ? vatOn(sub) : 0)]];
  y -= 6;
  for (const [label, cents] of totals) {
    const font = label === 'Total' ? f.bold : f.regular;
    right(label, cols.unit + 50, y, font);
    right(rand(cents).replace(/ /g, ' '), cols.total, y, font);
    y -= 18;
  }
  y = para(page, 'Initial every page of the pricing schedule and sign below.', M, y - 10, { font: f.regular, size: 9.5, color: MUTED });
  signature(page, f, y);
  return pdf;
}

async function filePart(path: string): Promise<PDFDocument | null> {
  const full = join(DATA_DIR, path);
  if (!existsSync(full)) return null;
  const bytes = readFileSync(full);
  const ext = extname(full).toLowerCase();
  try {
    if (ext === '.pdf') return await PDFDocument.load(bytes, { ignoreEncryption: true });
    if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
      const pdf = await PDFDocument.create();
      const img = ext === '.png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      const page = pdf.addPage(A4);
      const s = Math.min((A4[0] - 2 * M) / img.width, (A4[1] - 2 * M) / img.height, 1);
      page.drawImage(img, { x: (A4[0] - img.width * s) / 2, y: (A4[1] - img.height * s) / 2, width: img.width * s, height: img.height * s });
      return pdf;
    }
  } catch {
    return null;
  }
  return null;
}

async function placeholder(t: DeskTender, d: BidDocument, label: string, why?: string): Promise<PDFDocument> {
  const [pdf, f] = await withFonts();
  const page = pdf.addPage(A4);
  const y = header(page, f, `Not ready: ${d.name}`, sheetIntro(t));
  para(page, why ?? `${label}. This page holds its place so the draft shows the order and page numbers.`, M, y, { font: f.regular, size: 12 });
  return pdf;
}

/** The tender's own form pages the user pointed at, or a blank official form, if any. */
async function officialPages(t: DeskTender, d: BidDocument): Promise<PDFDocument | null> {
  const data = d.formDataJson ? JSON.parse(d.formDataJson) : {};
  const src: FormSource | undefined = data.source;
  if (src) {
    const td = t.documents.find((x) => x.id === src.docId);
    if (td?.pdfPath) {
      const whole = await filePart(td.pdfPath);
      if (whole) {
        const out = await PDFDocument.create();
        const idx = [];
        for (let p = src.from; p <= Math.min(src.to, whole.getPageCount()); p++) idx.push(p - 1);
        for (const page of await out.copyPages(whole, idx)) out.addPage(page);
        if (out.getPageCount()) return out;
      }
    }
  }
  const num = d.name.match(/^([SM]BD)\s*(\d+(?:\.\d+)?)/);
  if (num) {
    const blank = join(process.cwd(), 'tender-desk-kit', 'reference', 'forms', `${num[1]}-${num[2]}.pdf`);
    if (existsSync(blank)) return PDFDocument.load(readFileSync(blank), { ignoreEncryption: true });
  }
  return null;
}

async function append(target: PDFDocument, src: PDFDocument) {
  for (const p of await target.copyPages(src, src.getPageIndices())) target.addPage(p);
}

/** Each checklist item as a PDF of its own, compliance first, in checklist order. */
export async function packParts(desk: Desk, t: DeskTender): Promise<PackPart[]> {
  const docs = [...(t.bid?.docs ?? [])].sort((a, b) => (a.group === b.group ? a.sortOrder - b.sortOrder : a.group === 'compliance' ? -1 : 1));
  const parts: PackPart[] = [];
  for (const d of docs) {
    const state = desk.docState(t, d);
    let pdf: PDFDocument;
    if (!state.ok) {
      pdf = await placeholder(t, d, state.label);
    } else if (d.kind === 'form') {
      const sheet = d.formType === 'pricing' ? await pricingPart(desk, t, d) : await formPart(desk, t, d);
      const official = await officialPages(t, d);
      if (official) await append(sheet, official);
      pdf = sheet;
    } else {
      const path = d.kind === 'vault' ? desk.vaultDoc(d.vaultKind)?.filePath : d.filePath;
      pdf = (path && (await filePart(path))) || (await placeholder(t, d, state.label,
        path ? `The file ${path.split('/').pop()} can't be merged into a PDF. Print it and put it in at this point.` : 'The file is missing from data/.'));
    }
    parts.push({ doc: d, pdf, pages: pdf.getPageCount(), ready: state.ok, status: state.ok ? (d.kind === 'vault' ? 'From vault' : 'Ready') : state.label, sign: d.needsSignature });
  }
  return parts;
}

const INDEX_ROWS_PER_PAGE = 22;

export function indexPages(parts: PackPart[]): number {
  return Math.max(1, Math.ceil(parts.length / INDEX_ROWS_PER_PAGE));
}

/** The whole pack: index, parts, and a footer with page numbers on every page. */
export async function buildPack(desk: Desk, t: DeskTender, parts: PackPart[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const f = { regular: await out.embedFont(StandardFonts.Helvetica), bold: await out.embedFont(StandardFonts.HelveticaBold) };
  const draft = parts.some((p) => !p.ready);
  const nIndex = indexPages(parts);
  out.setTitle(clean(`Bid pack: ${t.title ?? t.reference ?? 'tender'}`));
  out.setProducer('iTender');

  // Index first, then each part.
  let at = nIndex + 1;
  const ranges = parts.map((p) => {
    const r = [at, at + p.pages - 1];
    at += p.pages;
    return r;
  });
  for (let ip = 0; ip < nIndex; ip++) {
    const page = out.addPage(A4);
    let y = ip === 0
      ? header(page, f, draft ? 'Bid pack (draft)' : 'Bid pack', `${sheetIntro(t)}${t.closesAt ? ` Closes ${fmtDayAt(t.closesAt)}.` : ''}`)
      : header(page, f, 'Bid pack, continued', sheetIntro(t));
    if (ip === 0) {
      const facts: [string, string | null][] = [
        ['Submit by', t.submitMethod], ['Where', t.submitWhere], ['Copies', t.submitCopies],
        ['Bidder', desk.profile?.name ?? null], ['CSD supplier number', desk.profile?.csdNumber ?? null],
      ];
      for (const [l, v] of facts) if (v) y = field(page, f, l, v, y);
      const sign = parts.filter((p) => p.sign).map((p) => p.doc.name.split(',')[0]);
      if (sign.length) y = para(page, `Sign: ${sign.join(', ')}.`, M, y - 6, { font: f.bold, size: 10.5 }) - 6;
      y -= 8;
    }
    page.drawText('Document', { x: M, y, size: 9.5, font: f.regular, color: MUTED });
    page.drawText('Pages', { x: A4[0] - M - 150, y, size: 9.5, font: f.regular, color: MUTED });
    page.drawText('Status', { x: A4[0] - M - 80, y, size: 9.5, font: f.regular, color: MUTED });
    y -= 16;
    const rows = parts.slice(ip * INDEX_ROWS_PER_PAGE, (ip + 1) * INDEX_ROWS_PER_PAGE);
    rows.forEach((p, k) => {
      const [a, b] = ranges[ip * INDEX_ROWS_PER_PAGE + k];
      const next = para(page, p.doc.name, M, y, { font: p.ready ? f.regular : f.bold, width: A4[0] - 2 * M - 170 });
      page.drawText(a === b ? String(a) : `${a}-${b}`, { x: A4[0] - M - 150, y, size: 10.5, font: f.regular, color: INK });
      page.drawText(clean(p.ready ? 'Ready' : p.status), { x: A4[0] - M - 80, y, size: 9.5, font: p.ready ? f.regular : f.bold, color: p.ready ? MUTED : INK });
      page.drawLine({ start: { x: M, y: next + 6 }, end: { x: A4[0] - M, y: next + 6 }, thickness: 0.5, color: LINE });
      y = next - 8;
    });
  }
  for (const p of parts) await append(out, p.pdf);

  // Footer on every page, over whatever the page already has.
  const total = out.getPageCount();
  const label = clean(`${t.reference ?? t.title ?? ''}${draft ? '  ·  DRAFT' : ''}`).slice(0, 70);
  out.getPages().forEach((page, i) => {
    const { width } = page.getSize();
    const text = `Page ${i + 1} of ${total}`;
    page.drawText(label, { x: 28, y: 16, size: 8, font: f.regular, color: MUTED });
    page.drawText(text, { x: width - 28 - f.regular.widthOfTextAtSize(text, 8), y: 16, size: 8, font: f.regular, color: MUTED });
  });
  return out.save();
}

/** An envelope label for tender-box submissions: big enough to read across a counter. */
export async function buildLabel(desk: Desk, t: DeskTender): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const f = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  const page = pdf.addPage([A4[1], A4[0]]); // landscape
  const w = A4[1] - 2 * M;
  page.drawRectangle({ x: M - 16, y: M - 16, width: w + 32, height: A4[0] - 2 * M + 32, borderColor: INK, borderWidth: 1.5 });
  let y = A4[0] - M - 24;
  y = para(page, `Tender ${t.reference ?? ''}`, M, y, { font: f.bold, size: 30, width: w, leading: 36 });
  y = para(page, t.title ?? '', M, y - 4, { font: f.regular, size: 16, width: w, leading: 22 });
  y -= 18;
  y = para(page, `Closing: ${t.closesAt ? fmtCloses(desk.now, t.closesAt).replace(/^(Today|Tomorrow)/, fmtDay(t.closesAt)) : 'see the tender document'}`, M, y, { font: f.bold, size: 18, width: w, leading: 24 });
  y = para(page, `To: ${[t.entity, t.submitWhere].filter(Boolean).join(', ')}`, M, y - 4, { font: f.regular, size: 16, width: w, leading: 22 });
  y -= 18;
  const P = desk.profile;
  para(page, `From: ${[P?.name, P?.contactPerson, P?.phone].filter(Boolean).join(', ') || 'your company name and contact details'}`, M, y, { font: f.regular, size: 14, width: w, leading: 20 });
  return pdf.save();
}
