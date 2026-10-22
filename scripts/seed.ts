// Loads the mockup's sample data for development. The mockup counts days from its own "today";
// here they count from the real today, so the sample stays useful whenever it's run.
// Wipes every table first, so it refuses to run over real data without --force.
import { db, schema } from '../src/lib/db.ts';
import { addDays, fromSast, startOfSastDay } from '../src/lib/dates.ts';

// Seeding wipes every table, real fetched tenders and bids included, so it needs --force once
// there's real data.
const real = await db.select({ ocid: schema.tenders.ocid }).from(schema.tenders);
if (real.some((t) => !t.ocid.startsWith('seed-')) && !process.argv.includes('--force')) {
  console.error('The database has real tenders. Seeding would wipe them, your bids and your vault. Run with --force to do it anyway.');
  process.exit(1);
}

const now = new Date();
const today = startOfSastDay(now);
const p = new Date(today.getTime() + 2 * 3600 * 1000);
/** `days` from today at a SAST time. */
const at = (days: number, time = '00:00') => {
  const [h, m] = time.split(':').map(Number);
  return fromSast(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate() + days, h, m);
};
const R = (rands: number) => rands * 100;

type Doc =
  | { kind: 'form'; name: string; formType: 'generic' | 'disclosure' | 'sbd61' | 'pricing'; done: boolean; pages: number }
  | { kind: 'vault'; name: string; vaultKind: string; pages: number; group?: 'functionality' }
  | { kind: 'upload'; name: string; done: boolean; pages: number };
const C = (name: string, formType: 'generic' | 'disclosure' | 'sbd61' | 'pricing', done: boolean, pages: number): Doc => ({ kind: 'form', name, formType, done, pages });
const V = (name: string, vaultKind: string, pages: number, group?: 'functionality'): Doc => ({ kind: 'vault', name, vaultKind, pages, group });
const U = (name: string, done: boolean, pages: number): Doc => ({ kind: 'upload', name, done, pages });

type Seed = {
  key: string; title: string; short: string; entity: string; province: string;
  work: 'website' | 'system' | 'design'; type: 'quotation' | 'open_bid'; days: number; time: string; pages: number; seen: boolean;
  briefing?: { days: number; time: string; where: string; compulsory: boolean };
  submit: [method: string, where: string | null, copies: string | null];
  func?: { threshold: number; criteria: [string, number, string][] };
  goals?: [string, number, string][];
  bid?: {
    stage: 'preparing' | 'submitted' | 'won' | 'lost';
    finalPrice?: number; submittedDays?: number; method?: string; winner?: string; winningPrice?: number;
    lines?: [string, number, number | null][]; docs?: Doc[];
  };
  change?: { field: string; oldDays: number; newDays: number; time: string; detectedDays: number; source: string };
};

const TENDERS: Seed[] = [
  {
    key: 'wmm-website', title: 'Website revamp and hosting', short: 'Winnie Madikizela-Mandela website revamp',
    entity: 'Winnie Madikizela-Mandela Local Municipality', province: 'Eastern Cape', work: 'website', type: 'open_bid', days: 1, time: '11:00', pages: 38, seen: true,
    submit: ['Tender box', 'Municipal offices, Main Street, Bizana', '1 original and 1 copy'],
    func: { threshold: 70, criteria: [['3 similar municipal websites in the last 5 years', 30, 'projects'], ['3 reference letters from clients', 20, 'refs'], ['Methodology and project plan', 30, 'upload'], ['CVs of the project lead and developer', 20, 'cvs']] },
    goals: [['51% or more owned by black people', 10, 'blackOwnershipPct'], ['51% or more owned by women', 5, 'womenOwnershipPct'], ['51% or more owned by youth', 3, 'youthOwned'], ['Based in the Eastern Cape', 2, 'province']],
    bid: {
      stage: 'preparing',
      lines: [['Design and development of new website', 1, null], ['Content migration from current site', 1, null], ['Hosting and support, 12 months', 12, null], ['Training for municipal staff', 1, null]],
      docs: [C('SBD 1, invitation to bid', 'generic', true, 2), C('SBD 4, bidder’s disclosure', 'disclosure', true, 3), C('SBD 6.1, preference points claim', 'sbd61', false, 4), C('Pricing schedule', 'pricing', false, 2),
        V('CSD summary report', 'csd', 3), V('Tax compliance PIN', 'tax', 1), V('B-BBEE sworn affidavit', 'bbbee', 2),
        U('Methodology and project plan', true, 8), V('Project list, last 5 years', 'projects', 2, 'functionality'), V('Client reference letters', 'refs', 4, 'functionality'), V('CVs of key staff', 'cvs', 6, 'functionality')],
    },
  },
  {
    key: 'salga-platform', title: 'Municipal participation platform', short: 'SALGA participation platform',
    entity: 'South African Local Government Association', province: 'National', work: 'system', type: 'quotation', days: 16, time: '11:00', pages: 22, seen: true,
    briefing: { days: 6, time: '10:00', where: 'Online', compulsory: false },
    submit: ['Email', 'tenders@[SALGA ADDRESS]', 'One PDF, under 10 MB'],
    func: { threshold: 60, criteria: [['2 similar platforms built', 40, 'projects'], ['Approach to co-design with municipalities', 40, 'upload'], ['Team CVs', 20, 'cvs']] },
    // R84 000 plus VAT is the mockup's R96 600.
    bid: {
      stage: 'preparing', lines: [['Platform build and 12 months support', 1, 84000]],
      docs: [C('SBD 1, invitation to bid', 'generic', true, 2), C('SBD 4, bidder’s disclosure', 'disclosure', true, 3), C('SBD 6.1, preference points claim', 'generic', true, 4), C('Pricing schedule', 'generic', true, 1),
        V('CSD summary report', 'csd', 3), V('Tax compliance PIN', 'tax', 1), U('Approach to co-design', true, 6), V('Project list, last 5 years', 'projects', 2, 'functionality'), V('CVs of key staff', 'cvs', 6, 'functionality')],
    },
    change: { field: 'closes_at', oldDays: 9, newDays: 16, time: '11:00', detectedDays: -1, source: 'Addendum 1' },
  },
  {
    key: 'rustenburg-app', title: 'Service delivery reporting app', short: 'Rustenburg reporting app',
    entity: 'Rustenburg Local Municipality', province: 'North West', work: 'system', type: 'quotation', days: 12, time: '12:00', pages: 18, seen: false,
    submit: ['Tender box', 'Civic Centre, Rustenburg', '1 original'],
    func: { threshold: 60, criteria: [['2 mobile apps delivered', 50, 'projects'], ['Support and maintenance plan', 30, 'upload'], ['Team CVs', 20, 'cvs']] },
  },
  {
    key: 'mogale-identity', title: 'Corporate identity and brochure design', short: 'Mogale City identity',
    entity: 'Mogale City Local Municipality', province: 'Gauteng', work: 'design', type: 'quotation', days: 20, time: '12:00', pages: 14, seen: false,
    submit: ['Tender box', 'Civic Centre, Krugersdorp', '1 original'],
  },
  {
    key: 'ekurhuleni-intranet', title: 'Intranet and document management system', short: 'Ekurhuleni intranet',
    entity: 'City of Ekurhuleni Metropolitan Municipality', province: 'Gauteng', work: 'system', type: 'open_bid', days: 23, time: '11:00', pages: 61, seen: false,
    briefing: { days: 8, time: '10:00', where: 'Germiston Civic Centre', compulsory: true },
    submit: ['Tender box', 'Germiston Civic Centre, ground floor', '1 original and 2 copies'],
    func: { threshold: 70, criteria: [['3 document management systems delivered', 35, 'projects'], ['Technical approach and architecture', 35, 'upload'], ['Certified team CVs', 30, 'cvs']] },
  },
  {
    key: 'tourism-maintenance', title: 'Website maintenance, 36 months', short: 'Tourism website maintenance',
    entity: 'Department of Tourism', province: 'National', work: 'website', type: 'open_bid', days: 26, time: '11:00', pages: 47, seen: false,
    submit: ['eTender upload', 'etenders.gov.za', 'One PDF'],
    func: { threshold: 65, criteria: [['Experience maintaining government websites', 40, 'projects'], ['Service level approach', 35, 'upload'], ['Team CVs', 25, 'cvs']] },
  },
  {
    key: 'dsbd-portal', title: 'Supplier portal redesign', short: 'DSBD supplier portal',
    entity: 'Department of Small Business Development', province: 'National', work: 'website', type: 'open_bid', days: -16, time: '11:00', pages: 30, seen: true,
    submit: ['eTender upload', 'etenders.gov.za', 'One PDF'],
    bid: { stage: 'submitted', finalPrice: 184000, submittedDays: -21, method: 'eTender upload' },
  },
  {
    key: 'bnlm-website', title: 'Website redesign', short: 'Dr Beyers Naudé website',
    entity: 'Dr Beyers Naudé Local Municipality', province: 'Eastern Cape', work: 'website', type: 'quotation', days: -70, time: '11:00', pages: 20, seen: true,
    submit: ['Tender box', null, null],
    bid: { stage: 'lost', finalPrice: 205000, winner: 'Bidder E', winningPrice: 190000 },
  },
  {
    key: 'nmb-identity', title: 'Visual identity refresh', short: 'Nelson Mandela Bay identity',
    entity: 'Nelson Mandela Bay Metropolitan Municipality', province: 'Eastern Cape', work: 'design', type: 'quotation', days: -120, time: '11:00', pages: 12, seen: true,
    submit: ['Tender box', null, null],
    bid: { stage: 'won', finalPrice: 145000 },
  },
];

// [kind, name, notes, expires in days or null, uploaded]
const VAULT: [string, string, string, number | null, boolean][] = [
  ['csd', 'CSD summary report', 'Downloaded 19 Oct', null, true],
  ['tax', 'Tax compliance PIN', 'Issued by SARS', 40, true],
  ['bbbee', 'B-BBEE sworn affidavit', 'Level 1, commissioned 4 Nov 2025', 14, true],
  ['cipc', 'CIPC registration certificate', 'CoR 14.3', null, true],
  ['ids', 'Certified ID copies of directors', 'Certified 1 Aug', 10, true],
  ['rates', 'Municipal rates clearance', 'Not uploaded yet', null, false],
  ['projects', 'Project list, last 5 years', '6 projects, updated Sep', null, true],
  ['refs', 'Client reference letters', '4 letters', null, true],
  ['cvs', 'CVs of key staff', '3 CVs', null, true],
];

// [entity, job, year, ocid key of the bid it came from, bids: [bidder, rands, won]]
const REGISTERS: [string, string, number, string | null, [string, number, boolean][]][] = [
  ['Winnie Madikizela-Mandela LM', 'Website revamp', 2025, null, [['Bidder A', 85000, false], ['Bidder B', 165000, true], ['Bidder C', 340000, false]]],
  ['Dr Beyers Naudé LM', 'Website redesign', 2026, 'bnlm-website', [['Bidder D', 120000, false], ['Bidder E', 190000, true], ['Your bid', 205000, false]]],
  ['Sol Plaatje LM', 'Website and hosting', 2024, null, [['Bidder F', 210000, true], ['Bidder G', 260000, false]]],
];

const ocid = (key: string) => `seed-${key}`;

await db.transaction(async (tx) => {
  for (const table of [schema.registerBids, schema.bidRegisters, schema.pricingLines, schema.bidDocuments, schema.bids, schema.specificGoals, schema.funcCriteria,
    schema.tenderChanges, schema.tenderDocuments, schema.tenders, schema.buyers, schema.vaultDocuments, schema.companyProfile, schema.settings,
    schema.fetchRuns, schema.alertsSent, schema.aiCalls]) {
    await tx.delete(table);
  }

  await tx.insert(schema.companyProfile).values({
    id: 1, name: '[YOUR COMPANY] (Pty) Ltd', initials: 'YC', registrationNumber: '2019/123456/07', csdNumber: 'MAAA0123456', taxPin: '[TAX PIN]',
    vatRegistered: true, vatNumber: '4123456789', address: '[STREET ADDRESS], Johannesburg, 2001', contactPerson: '[CONTACT PERSON]', phone: '[PHONE]',
    email: '[EMAIL]', province: 'Gauteng', blackOwnershipPct: 100, womenOwnershipPct: 60, youthOwned: false,
  });
  await tx.insert(schema.settings).values({ id: 1, alertEmail: '[EMAIL]', alertMode: 'instant', alertOnChanges: true });

  await tx.insert(schema.vaultDocuments).values(VAULT.map(([kind, name, notes, expires, uploaded]) => ({
    kind, name, notes, filePath: uploaded ? `vault/seed-${kind}.pdf` : null, expiresAt: expires === null ? null : at(expires),
  })));

  for (const t of TENDERS) {
    const id = ocid(t.key);
    await tx.insert(schema.tenders).values({
      ocid: id, reference: '[TENDER REFERENCE]', title: t.title, shortTitle: t.short, entity: t.entity, province: t.province, provinceSource: 'lookup',
      workType: t.work, tenderType: t.type, relevant: true, relevanceReason: 'Sample data', closesAt: at(t.days, t.time), publishedAt: at(t.days - 28),
      briefingAt: t.briefing ? at(t.briefing.days, t.briefing.time) : null, briefingWhere: t.briefing?.where ?? null, briefingCompulsory: t.briefing?.compulsory ?? false,
      submitMethod: t.submit[0], submitWhere: t.submit[1], submitCopies: t.submit[2], funcThreshold: t.func?.threshold ?? null,
      preferenceSystem: '80/20', firstSeenAt: at(t.days - 28), openedAt: t.seen ? addDays(today, -1) : null, updatedAt: now,
    });
    await tx.insert(schema.tenderDocuments).values({ ocid: id, title: 'Tender document', format: 'pdf', pages: t.pages, belongsCheck: 'ok' });
    if (t.func) await tx.insert(schema.funcCriteria).values(t.func.criteria.map(([name, points, evidence]) => ({ ocid: id, name, points, evidence })));
    if (t.goals) await tx.insert(schema.specificGoals).values(t.goals.map(([name, points, profileField]) => ({ ocid: id, name, points, profileField })));
    if (t.change) {
      const c = t.change;
      await tx.insert(schema.tenderChanges).values({
        ocid: id, field: c.field, oldValue: at(c.oldDays, c.time).toISOString(), newValue: at(c.newDays, c.time).toISOString(), source: c.source, detectedAt: at(c.detectedDays, '07:00'),
      });
    }
    if (!t.bid) continue;

    const b = t.bid;
    const result = b.stage === 'won' || b.stage === 'lost' ? b.stage : null;
    const [bid] = await tx.insert(schema.bids).values({
      ocid: id, stage: b.stage, startedAt: at(t.days - 21), submittedAt: b.submittedDays !== undefined ? at(b.submittedDays, '10:00') : result ? at(t.days - 1) : null,
      submitMethod: b.method ?? (result ? t.submit[0] : null), finalPriceCents: b.finalPrice ? R(b.finalPrice) : null, result, winnerName: b.winner ?? null,
      winningPriceCents: b.winningPrice ? R(b.winningPrice) : b.stage === 'won' && b.finalPrice ? R(b.finalPrice) : null, resultRecordedAt: result ? at(t.days + 20) : null,
    }).returning();
    if (b.lines) await tx.insert(schema.pricingLines).values(b.lines.map(([label, quantity, unit], i) => ({ bidId: bid.id, label, quantity, unitPriceCents: unit === null ? null : R(unit), sortOrder: i })));
    if (b.docs) await tx.insert(schema.bidDocuments).values(b.docs.map((d, i) => ({
      bidId: bid.id, name: d.name, kind: d.kind, pages: d.pages, sortOrder: i,
      group: d.kind === 'upload' || (d.kind === 'vault' && d.group) ? 'functionality' as const : 'compliance' as const,
      formType: d.kind === 'form' ? d.formType : null, vaultKind: d.kind === 'vault' ? d.vaultKind : null,
      done: d.kind === 'vault' ? false : d.done, needsSignature: d.kind === 'form',
    })));
  }

  for (const [entity, job, year, key, rows] of REGISTERS) {
    const [reg] = await tx.insert(schema.bidRegisters).values({ entity, job, workType: 'website', year, ocid: key ? ocid(key) : null, createdAt: now }).returning();
    await tx.insert(schema.registerBids).values(rows.map(([bidder, rands, won]) => ({ registerId: reg.id, bidder, priceCents: R(rands), won })));
  }
});

console.log(`Seeded ${TENDERS.length} tenders, ${TENDERS.filter((t) => t.bid).length} bids, ${VAULT.length} vault documents and ${REGISTERS.length} bid registers.`);
