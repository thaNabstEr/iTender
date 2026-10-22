// Loads what the screens need and applies the product rules in PLAN.md: bid stages, document
// status, nav counters and the banner. Every screen reads from here, so a fact shown in two
// places always comes from the same value.
import { desc, eq, getTableColumns } from 'drizzle-orm';
import { db, schema } from './db.ts';
import { addDays, daysFrom, fmtDay, fmtDayAt, fmtTime } from './dates.ts';
import { vatOn } from './money.ts';

const { rawJson: _raw, ...tenderColumns } = getTableColumns(schema.tenders);

type Tender = Omit<typeof schema.tenders.$inferSelect, 'rawJson'>;
type Bid = typeof schema.bids.$inferSelect;
export type BidDocument = typeof schema.bidDocuments.$inferSelect;
export type VaultDocument = typeof schema.vaultDocuments.$inferSelect;
export type Profile = typeof schema.companyProfile.$inferSelect;
export type Settings = typeof schema.settings.$inferSelect;
type Change = typeof schema.tenderChanges.$inferSelect;
type PricingLine = typeof schema.pricingLines.$inferSelect;
type Criterion = typeof schema.funcCriteria.$inferSelect;

export type Stage = 'preparing' | 'submitted' | 'awaiting' | 'won' | 'lost' | 'cancelled';

export interface DeskTender extends Tender {
  bid: (Bid & { docs: BidDocument[]; lines: PricingLine[] }) | null;
  changes: Change[];
  criteria: Criterion[];
}

export interface Register {
  id: number;
  entity: string | null;
  job: string | null;
  workType: 'website' | 'system' | 'design' | null;
  year: number | null;
  bids: { bidder: string | null; priceCents: number | null; won: boolean }[];
}

export const WORK_LABEL = { website: 'Website', system: 'System', design: 'Design' } as const;
export const WORK_PLURAL = { website: 'website', system: 'systems', design: 'design' } as const;
export const TYPE_LABEL = { quotation: 'Quotation', open_bid: 'Open bid' } as const;
export const PROVINCES = ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape'];

export async function loadDesk(now = new Date()) {
  const [tenderRows, bidRows, docRows, lineRows, changeRows, criteriaRows, vault, profiles, settingsRows, registerRows, registerBidRows, lastRuns] =
    await Promise.all([
      db.select(tenderColumns).from(schema.tenders),
      db.select().from(schema.bids),
      db.select().from(schema.bidDocuments).orderBy(schema.bidDocuments.sortOrder),
      db.select().from(schema.pricingLines).orderBy(schema.pricingLines.sortOrder),
      db.select().from(schema.tenderChanges).orderBy(desc(schema.tenderChanges.detectedAt)),
      db.select().from(schema.funcCriteria),
      db.select().from(schema.vaultDocuments).orderBy(schema.vaultDocuments.id),
      db.select().from(schema.companyProfile).where(eq(schema.companyProfile.id, 1)),
      db.select().from(schema.settings).where(eq(schema.settings.id, 1)),
      db.select().from(schema.bidRegisters).orderBy(desc(schema.bidRegisters.year), schema.bidRegisters.id),
      db.select().from(schema.registerBids).orderBy(schema.registerBids.id),
      db.select().from(schema.fetchRuns).orderBy(desc(schema.fetchRuns.startedAt)).limit(1),
    ]);

  const tenders: DeskTender[] = tenderRows
    .filter((t) => t.relevant || bidRows.some((b) => b.ocid === t.ocid))
    .map((t) => {
      const bid = bidRows.find((b) => b.ocid === t.ocid);
      return {
        ...t,
        bid: bid ? { ...bid, docs: docRows.filter((d) => d.bidId === bid.id), lines: lineRows.filter((l) => l.bidId === bid.id) } : null,
        changes: changeRows.filter((c) => c.ocid === t.ocid),
        criteria: criteriaRows.filter((c) => c.ocid === t.ocid),
      };
    });

  const registers: Register[] = registerRows.map((r) => ({
    id: r.id,
    entity: r.entity,
    job: r.job,
    workType: r.workType,
    year: r.year,
    bids: registerBidRows.filter((b) => b.registerId === r.id),
  }));

  return new Desk(now, tenders, vault, profiles[0] ?? null, settingsRows[0] ?? null, registers, lastRuns[0] ?? null);
}

export type BannerItem = { text: string; href: string; label: string };

type FetchRun = typeof schema.fetchRuns.$inferSelect;

export class Desk {
  readonly now: Date;
  readonly tenders: DeskTender[];
  readonly vault: VaultDocument[];
  readonly profile: Profile | null;
  readonly settings: Settings | null;
  readonly registers: Register[];
  readonly lastFetch: FetchRun | null;

  constructor(now: Date, tenders: DeskTender[], vault: VaultDocument[], profile: Profile | null, settings: Settings | null, registers: Register[], lastFetch: FetchRun | null) {
    this.now = now;
    this.tenders = tenders;
    this.vault = vault;
    this.profile = profile;
    this.settings = settings;
    this.registers = registers;
    this.lastFetch = lastFetch;
  }

  /** Calendar days from today to closing, in SAST. Null when the closing date isn't known. */
  days(t: DeskTender): number | null {
    return t.closesAt ? daysFrom(this.now, t.closesAt) : null;
  }

  isOpen(t: DeskTender): boolean {
    return !t.cancelled && !!t.closesAt && t.closesAt > this.now;
  }

  /** Closes within 2 days, so the date gets the highlighter. */
  closesSoon(t: DeskTender): boolean {
    const d = this.days(t);
    return this.isOpen(t) && d !== null && d <= 2;
  }

  stage(t: DeskTender): Stage | null {
    if (!t.bid) return null;
    if (t.bid.stage === 'submitted' && t.closesAt && t.closesAt <= this.now) return 'awaiting';
    return t.bid.stage;
  }

  isActive(t: DeskTender): boolean {
    const s = this.stage(t);
    return s === 'preparing' || s === 'submitted' || s === 'awaiting';
  }

  /** A submitted bid whose result is due: closing date plus 14 days, not yet recorded. */
  resultDue(t: DeskTender): boolean {
    return this.stage(t) === 'awaiting' && !!t.closesAt && addDays(t.closesAt, 14) <= this.now;
  }

  resultExpected(t: DeskTender): Date | null {
    return t.closesAt ? addDays(t.closesAt, 14) : null;
  }

  vaultDoc(kind: string | null): VaultDocument | undefined {
    return this.vault.find((v) => v.kind === kind);
  }

  /** A form or upload is done when saved; a vault document is ready if it exists and is valid on the closing date. */
  docState(t: DeskTender, d: BidDocument): { ok: boolean; label: string } {
    if (d.kind !== 'vault') return d.done ? { ok: true, label: 'Done' } : { ok: false, label: 'To do' };
    const v = this.vaultDoc(d.vaultKind);
    if (!v || !v.filePath) return { ok: false, label: 'Not in vault' };
    if (v.expiresAt && (this.expired(v) || (t.closesAt && expiresBefore(v.expiresAt, t.closesAt)))) return { ok: false, label: 'Expires before closing' };
    return { ok: true, label: 'From vault' };
  }

  missingDocs(t: DeskTender): BidDocument[] {
    return t.bid ? t.bid.docs.filter((d) => !this.docState(t, d).ok) : [];
  }

  vatRegistered(): boolean {
    return this.profile?.vatRegistered ?? false;
  }

  /** The pricing schedule total, with VAT when the business is VAT-registered. Null when nothing is priced. */
  pricingTotal(t: DeskTender): number | null {
    if (!t.bid) return null;
    const sub = t.bid.lines.reduce((a, l) => a + l.quantity * (l.unitPriceCents ?? 0), 0);
    if (!sub) return null;
    return sub + (this.vatRegistered() ? vatOn(sub) : 0);
  }

  /** The final price once submitted, otherwise the pricing schedule total. */
  bidPrice(t: DeskTender): number | null {
    return t.bid?.finalPriceCents ?? this.pricingTotal(t);
  }

  /** Open, relevant tenders not yet opened and not being bid on, first to close first. */
  newTenders(): DeskTender[] {
    return this.openTenders().filter((t) => !t.openedAt && !t.bid);
  }

  openTenders(): DeskTender[] {
    return this.tenders.filter((t) => t.relevant && this.isOpen(t)).sort(byClosing);
  }

  activeBids(): DeskTender[] {
    return this.tenders.filter((t) => this.isActive(t)).sort(byClosing);
  }

  bidsAt(stage: Stage): DeskTender[] {
    return this.tenders.filter((t) => this.stage(t) === stage).sort(byClosing);
  }

  closedBids(): DeskTender[] {
    return this.tenders.filter((t) => ['won', 'lost'].includes(this.stage(t) ?? '')).sort((a, b) => -byClosing(a, b));
  }

  /** Open bids that use a vault document, for the "Used in" column. */
  vaultUsedIn(v: VaultDocument): DeskTender[] {
    return this.activeBids().filter((t) => this.isOpen(t) && t.bid!.docs.some((d) => d.kind === 'vault' && d.vaultKind === v.kind));
  }

  /** Active bids that close after this document expires. */
  vaultClashes(v: VaultDocument): DeskTender[] {
    return this.vaultUsedIn(v).filter((t) => v.expiresAt && t.closesAt && expiresBefore(v.expiresAt, t.closesAt));
  }

  /** A document is valid through its expiry date. */
  expired(v: VaultDocument): boolean {
    return !!v.expiresAt && expiresBefore(v.expiresAt, this.now);
  }

  /** Missing, expired, or expiring before an active bid that needs it closes. */
  vaultProblems(): VaultDocument[] {
    return this.vault.filter((v) => !v.filePath || this.expired(v) || this.vaultClashes(v).length > 0);
  }

  counters() {
    return { tenders: this.newTenders().length, bids: this.activeBids().length, vault: this.vaultProblems().length };
  }

  name(t: DeskTender): string {
    return t.shortTitle ?? t.title ?? t.reference ?? 'This tender';
  }

  /** Banner items, most urgent first. */
  bannerItems(): BannerItem[] {
    const active = this.activeBids();
    const href = (t: DeskTender) => `/tenders/${encodeURIComponent(t.ocid)}`;
    const in48h = (d: Date | null) => !!d && d > this.now && d.getTime() - this.now.getTime() <= 48 * 3600 * 1000;
    const items: BannerItem[] = [];

    for (const t of active) {
      const m = this.missingDocs(t);
      if (this.stage(t) === 'preparing' && in48h(t.closesAt) && m.length) {
        const day = this.days(t) === 0 ? 'today' : this.days(t) === 1 ? 'tomorrow' : fmtDay(t.closesAt!);
        const more = m.length > 1 ? ` and ${m.length - 1} more` : '';
        items.push({ text: `${this.name(t)} closes ${day} at ${fmtTime(t.closesAt!)}. ${shortDoc(m[0].name)}${more} still to do.`, href: href(t), label: 'Finish it' });
      }
    }
    for (const t of active) {
      const c = t.changes.find((c) => !c.seenAt);
      if (c) items.push({ text: `${this.name(t)} changed: ${lowerFirst(changeText(c))}.`, href: href(t), label: 'See the change' });
    }
    for (const t of active) {
      if (t.briefingCompulsory && in48h(t.briefingAt)) {
        const where = t.briefingWhere ? `, ${t.briefingWhere}` : '';
        items.push({ text: `${this.name(t)} has a compulsory briefing ${fmtDayAt(t.briefingAt!)}${where}. Missing it disqualifies the bid.`, href: href(t), label: 'See the details' });
      }
    }
    for (const t of active) {
      if (this.resultDue(t)) items.push({ text: `The ${this.name(t)} result should be out by now.`, href: `${href(t)}/result`, label: 'Record the result' });
    }
    return items;
  }
}

/** True when the expiry date is a calendar day before `d`, in SAST. */
function expiresBefore(expiresAt: Date, d: Date): boolean {
  return daysFrom(d, expiresAt) < 0;
}

function byClosing(a: DeskTender, b: DeskTender): number {
  return (a.closesAt?.getTime() ?? Infinity) - (b.closesAt?.getTime() ?? Infinity);
}

/** "SBD 6.1, preference points claim" -> "SBD 6.1" */
export function shortDoc(name: string): string {
  return name.split(',')[0];
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** A change in words, e.g. "Closing date moved from Fri 30 Oct to Fri 6 Nov". */
export function changeText(c: Change): string {
  const day = (v: string | null) => (v ? fmtDay(new Date(v)) : 'an unknown date');
  switch (c.field) {
    case 'closes_at':
      return `Closing date moved from ${day(c.oldValue)} to ${day(c.newValue)}`;
    case 'briefing_at':
      return `Briefing moved from ${day(c.oldValue)} to ${day(c.newValue)}`;
    case 'document':
      return `New document added: ${c.newValue ?? 'untitled'}`;
    case 'cancelled':
      return 'Tender cancelled';
    default:
      return `${c.field} changed from ${c.oldValue ?? 'nothing'} to ${c.newValue ?? 'nothing'}`;
  }
}
