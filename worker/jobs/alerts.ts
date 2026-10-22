// Alert emails and daily reminders, following the Settings choices:
// - New tenders: one email each as they're found (instant), or one at 07:00 on weekdays (digest).
// - A tender being bid on changed: one email per change, if "email me when it changes" is on.
// - Daily at 07:00: compulsory briefings within 48 hours, vault documents expiring before a bid
//   closes, and results that are due.
// Every alert is recorded in alerts_sent (unique on kind and ref), so nothing goes out twice.
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../../src/lib/db.ts';
import { docInSentence, loadDesk, TYPE_LABEL, WORK_PLURAL, type Desk, type DeskTender } from '../../src/lib/desk.ts';
import { readableText } from '../../src/lib/classify.ts';
import { addDays, daysFrom, fmtCloses, fmtDay, fmtDayAt } from '../../src/lib/dates.ts';
import { rand } from '../../src/lib/money.ts';
import {
  button, facts, forestPanel, heading, hugeFigure, layout, link, pad, recipient, row, rows, section, send, textOf,
} from '../../src/lib/email.ts';

type Log = (msg: string) => void;

/** More new tenders than this in one go (a catch-up, the first run) become one email, not many. */
const MAX_SEPARATE = 3;
/** New-tender alerts only cover tenders found this recently, so old ones never trickle out. */
const NEW_WINDOW_MS = 24 * 3600 * 1000;

async function alreadySent(kind: string, refs: string[]): Promise<Set<string>> {
  if (!refs.length) return new Set();
  const rows = await db.select({ ref: schema.alertsSent.ref }).from(schema.alertsSent)
    .where(and(eq(schema.alertsSent.kind, kind), inArray(schema.alertsSent.ref, refs)));
  return new Set(rows.map((r) => r.ref));
}

async function markSent(kind: string, refs: string[]) {
  if (!refs.length) return;
  await db.insert(schema.alertsSent).values(refs.map((ref) => ({ kind, ref, sentAt: new Date() }))).onConflictDoNothing();
}

const href = (t: DeskTender) => link(`/tenders/${encodeURIComponent(t.ocid)}`);
const place = (t: DeskTender) => [t.entity, t.province].filter(Boolean).join(', ');
const workWord = (t: DeskTender) => (t.workType ? `${WORK_PLURAL[t.workType]} ` : '');

function closesIn(desk: Desk, t: DeskTender): string {
  const d = desk.days(t);
  return d === null ? 'The closing date isn’t given.' : d === 0 ? 'It closes today.' : d === 1 ? 'It closes tomorrow.' : `It closes in ${d} days.`;
}

// ---------- New tenders ----------

function newTenderEmail(desk: Desk, t: DeskTender, to: string) {
  const html = layout(
    heading(t.title ?? t.reference ?? 'A new tender', `A new ${workWord(t)}tender from ${place(t) || 'eTenders'}. ${closesIn(desk, t)}`) +
      facts([
        ['Closes', t.closesAt ? fmtCloses(desk.now, t.closesAt) : 'Not given'],
        ['Type', t.tenderType ? TYPE_LABEL[t.tenderType] : 'Not given'],
        ['Briefing', t.briefingAt ? `${t.briefingCompulsory ? 'Compulsory, ' : ''}${fmtDay(t.briefingAt)}` : 'Not read yet'],
        ['Documents', `${t.documents.length} on eTenders`],
      ]) +
      pad(section('Why it matched', t.relevanceReason ?? '') + section('What it’s for', readableText(t.description) ?? ''), 28) +
      pad(button(href(t), 'Open in iTender'), 4),
    'You get an email for each new tender in websites, systems and design. Prefer one email each weekday morning? Switch to the digest in Settings.',
  );
  return { kind: 'new-tender', to, subject: `New tender: ${t.title ?? t.reference}`, html, text: textOf(html) };
}

function newTendersEmail(desk: Desk, list: DeskTender[], to: string, digest: boolean) {
  const urgent = digest ? desk.activeBids().find((t) => desk.stage(t) === 'preparing' && (desk.days(t) ?? 9) <= 1 && desk.missingDocs(t).length) : undefined;
  const bids = digest ? desk.activeBids().slice(0, 4) : [];
  const urgentPanel = urgent
    ? forestPanel(
      `Closes ${desk.days(urgent) === 0 ? 'today' : 'tomorrow'} at ${fmtCloses(desk.now, urgent.closesAt!).split(', ')[1]}`,
      `${desk.name(urgent)}. ${listWords(desk.missingDocs(urgent).map((d) => docInSentence(d.name)))} ${desk.missingDocs(urgent).length === 1 ? 'is' : 'are'} still to do.`,
      href(urgent), 'Finish the bid')
    : '';
  const tenderRows = list.map((t) => row(
    t.title ?? t.reference ?? 'Untitled', href(t),
    `${place(t)}${t.tenderType ? `. ${TYPE_LABEL[t.tenderType]}` : ''}`,
    t.closesAt ? fmtDay(t.closesAt) : 'No date',
  ));
  const bidRows = bids.map((t) => {
    const stage = desk.stage(t);
    const missing = desk.missingDocs(t);
    const sub = `${t.entity ?? ''}. ${stage === 'preparing' ? (missing.length ? `${missing.length} of ${t.bid!.docs.length} documents to go` : `All ${t.bid!.docs.length} documents ready`) : stage === 'submitted' ? 'Submitted' : 'Awaiting the result'}`;
    const right = desk.resultDue(t) ? 'Record the result' : stage === 'preparing' && t.closesAt ? `Hand in by ${fmtDay(t.closesAt)}` : t.closesAt ? `Closed ${fmtDay(t.closesAt)}` : '';
    return row(t.title ?? t.reference ?? 'Untitled', href(t), sub, right, desk.resultDue(t));
  });
  const n = list.length;
  const html = layout(
    urgentPanel +
      `<div style="padding:36px 40px 0">${hugeFigure(`${n} new ${n === 1 ? 'tender' : 'tenders'}`, digest ? 'Found since the last digest, in websites, systems and design.' : 'Found in the latest fetch, in websites, systems and design.')}${rows(tenderRows)}</div>` +
      (bidRows.length ? `<div style="padding:36px 40px 0"><h2 style="margin:0 0 12px;font-size:22px;font-weight:800;letter-spacing:-0.02em">Your bids</h2>${rows(bidRows)}</div>` : '') +
      pad(button(link('/'), 'Open in iTender'), 32),
    digest
      ? 'Sent each weekday at 07:00. Prefer an email as soon as each tender is found? Change it in Settings.'
      : 'This many were found at once, so they’re in one email. Prefer one email each weekday morning? Switch to the digest in Settings.',
    digest ? new Intl.DateTimeFormat('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Johannesburg' }).format(desk.now) : undefined,
  );
  return { kind: digest ? 'digest' : 'new-tenders', to, subject: `${n} new ${n === 1 ? 'tender' : 'tenders'}`, html, text: textOf(html) };
}

function listWords(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** New relevant tenders not yet emailed. `digest` sends whatever's waiting; otherwise only instant mode sends. */
export async function sendNewTenders(log: Log, { digest = false } = {}) {
  const desk = await loadDesk();
  const mode = desk.settings?.alertMode ?? 'instant';
  if (digest !== (mode === 'digest')) return;
  const to = recipient(desk.settings?.alertEmail);
  const fresh = desk.newTenders().filter((t) => !t.ocid.startsWith('seed-') && t.firstSeenAt && (digest || desk.now.getTime() - t.firstSeenAt.getTime() <= NEW_WINDOW_MS));
  const sent = await alreadySent('new-tender', fresh.map((t) => t.ocid));
  const todo = fresh.filter((t) => !sent.has(t.ocid));
  if (!todo.length) return log(digest ? 'digest: nothing new, no email' : 'alerts: no new tenders to send');
  if (!to) return log(`alerts: ${todo.length} new ${todo.length === 1 ? 'tender' : 'tenders'} to send, but there’s no alert email in Settings`);
  if (digest || todo.length > MAX_SEPARATE) send(newTendersEmail(desk, todo, to, digest), log);
  else for (const t of todo) send(newTenderEmail(desk, t, to), log);
  await markSent('new-tender', todo.map((t) => t.ocid));
}

// ---------- Changes to tenders being bid on ----------

function changeEmail(desk: Desk, t: DeskTender, c: DeskTender['changes'][number], to: string) {
  const buyer = t.entity ?? 'The buyer';
  const missing = desk.missingDocs(t);
  const price = desk.bidPrice(t);
  const standing = t.bid
    ? `${missing.length ? `${missing.length} of ${t.bid.docs.length} documents still to do` : `All ${t.bid.docs.length} documents are ready`}${price ? ` and your price is ${rand(price)}` : ''}.`
    : '';
  let title: string, lede: string, panel = '';
  if (c.field === 'closes_at' && c.oldValue && c.newValue) {
    const was = new Date(c.oldValue), now = new Date(c.newValue);
    const diff = daysFrom(was, now);
    title = `${buyer} moved the closing date`;
    lede = `The ${t.title ?? 'tender'} you’re bidding on has a new closing date. ${diff > 0 ? `You have ${diff === 7 ? 'one more week' : `${diff} more ${diff === 1 ? 'day' : 'days'}`}.` : `It’s ${Math.abs(diff)} ${Math.abs(diff) === 1 ? 'day' : 'days'} sooner.`}`;
    panel = facts([['Was', fmtCloses(desk.now, was)], ['New closing date', fmtCloses(desk.now, now)]], { big: true, struck: 0 });
  } else if (c.field === 'cancelled') {
    title = `${buyer} cancelled the tender`;
    lede = `The ${t.title ?? 'tender'} you’re bidding on is listed as cancelled on eTenders.`;
  } else {
    const titles = (c.newValue ?? '').split('\n').filter(Boolean);
    title = `${buyer} added ${titles.length === 1 ? 'a document' : `${titles.length} documents`}`;
    lede = `The ${t.title ?? 'tender'} you’re bidding on has ${c.source ? `${c.source.toLowerCase().startsWith('addend') ? 'an addendum' : 'new documents'}` : 'new documents'}. Read ${titles.length === 1 ? 'it' : 'them'} before you hand in.`;
    panel = facts([['New on eTenders', titles.slice(0, 3).join(', ') + (titles.length > 3 ? ` and ${titles.length - 3} more` : '')]]);
  }
  const html = layout(
    heading(title, lede) + panel +
      pad(button(href(t), 'See the change'), 32) +
      pad(section('Where your bid stands', `${standing} ${t.closesAt ? `Hand it in before ${fmtDayAt(t.closesAt)}.` : ''}`.trim())),
    'You get these emails when a tender you’re bidding on changes. Turn them off in Settings.',
  );
  return { kind: 'change', to, subject: title, html, text: textOf(html) };
}

export async function sendChanges(log: Log) {
  const desk = await loadDesk();
  if (desk.settings && !desk.settings.alertOnChanges) return;
  const to = recipient(desk.settings?.alertEmail);
  const recent = addDays(desk.now, -3);
  const items = desk.activeBids().flatMap((t) => t.changes.filter((c) => c.detectedAt >= recent && !t.ocid.startsWith('seed-')).map((c) => ({ t, c })));
  const sent = await alreadySent('change', items.map((i) => String(i.c.id)));
  const todo = items.filter((i) => !sent.has(String(i.c.id)));
  if (!todo.length) return;
  if (!to) return log(`alerts: ${todo.length} bid ${todo.length === 1 ? 'change' : 'changes'} to send, but there’s no alert email in Settings`);
  for (const { t, c } of todo) send(changeEmail(desk, t, c, to), log);
  await markSent('change', todo.map((i) => String(i.c.id)));
}

// ---------- Daily reminders ----------

function reminderEmail(kind: string, title: string, lede: string, panel: [string, string][], href: string, label: string, to: string) {
  const html = layout(heading(title, lede) + facts(panel) + pad(button(href, label), 32), 'Reminders come each morning for briefings, expiring documents and results that are due.');
  return { kind, to, subject: title, html, text: textOf(html) };
}

export async function sendReminders(log: Log) {
  const desk = await loadDesk();
  const to = recipient(desk.settings?.alertEmail);
  const out: { kind: string; ref: string; email: (to: string) => ReturnType<typeof reminderEmail> }[] = [];
  const in48h = (d: Date | null) => !!d && d > desk.now && d.getTime() - desk.now.getTime() <= 48 * 3600 * 1000;

  for (const t of desk.activeBids()) {
    if (t.briefingCompulsory && in48h(t.briefingAt)) {
      out.push({
        kind: 'briefing', ref: `${t.ocid}@${t.briefingAt!.toISOString()}`,
        email: (to) => reminderEmail('briefing', `Compulsory briefing ${daysFrom(desk.now, t.briefingAt!) === 0 ? 'today' : 'tomorrow'}`,
          `For the ${t.title ?? 'tender'} you’re bidding on. Missing it disqualifies the bid.`,
          [['When', fmtDayAt(t.briefingAt!)], ['Where', t.briefingWhere ?? 'Check the tender document']], href(t), 'See the details', to),
      });
    }
    if (desk.resultDue(t)) {
      out.push({
        kind: 'result-due', ref: t.ocid,
        email: (to) => reminderEmail('result-due', 'A result should be out by now',
          `The ${t.title ?? 'tender'} closed two weeks ago. Win or lose, record it so the winning price goes into your price history.`,
          [['Closed', t.closesAt ? fmtDay(t.closesAt) : 'Not given'], ['You bid', desk.bidPrice(t) ? rand(desk.bidPrice(t)!) : 'Not recorded']],
          link(`/tenders/${encodeURIComponent(t.ocid)}/result`), 'Record the result', to),
      });
    }
  }
  for (const v of desk.vault) {
    const expiresAt = v.expiresAt;
    if (!expiresAt || !v.filePath) continue;
    const clash = desk.vaultClashes(v);
    const soon = expiresAt <= addDays(desk.now, 14);
    if (!clash.length && !(soon && desk.vaultUsedIn(v).length)) continue;
    out.push({
      kind: 'vault-expiry', ref: `${v.id}@${expiresAt.toISOString()}`,
      email: (to) => reminderEmail('vault-expiry', `${v.name} ${desk.expired(v) ? 'has expired' : 'expires soon'}`,
        clash.length ? `It expires before ${clash.length === 1 ? `the ${clash[0].title ?? 'tender'} closes` : `${clash.length} of your bids close`}. Get a new one and replace it in the vault.` : 'It’s used in an active bid. Get a new one and replace it in the vault.',
        [['Valid until', fmtDay(expiresAt)], ['Used in', `${desk.vaultUsedIn(v).length} active ${desk.vaultUsedIn(v).length === 1 ? 'bid' : 'bids'}`]],
        link(`/vault/${v.id}`), 'Replace it', to),
    });
  }

  if (!out.length) return log('reminders: nothing due');
  const fresh = [];
  for (const kind of new Set(out.map((o) => o.kind))) {
    const sent = await alreadySent(kind, out.filter((o) => o.kind === kind).map((o) => o.ref));
    fresh.push(...out.filter((o) => o.kind === kind && !sent.has(o.ref)));
  }
  if (!fresh.length) return log('reminders: all already sent');
  if (!to) return log(`reminders: ${fresh.length} to send, but there’s no alert email in Settings`);
  for (const o of fresh) {
    send(o.email(to), log);
    await markSent(o.kind, [o.ref]);
  }
}
