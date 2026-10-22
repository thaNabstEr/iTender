import { mkdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { and, eq, inArray, max } from 'drizzle-orm';
import { DATA_DIR, db, schema } from '../lib/db.ts';
import { fromSast, sastYear } from '../lib/dates.ts';
import { starterChecklist } from '../lib/checklist.ts';
import { PROVINCES } from '../lib/desk.ts';
import { RULES, check, formatPhone, tidy, type RuleName } from '../lib/validation.ts';

// Empty and missing fields are both stored as null.
const text = z.string().nullish().transform((s) => s?.trim() || null);
/** A text field checked against one of the South African rules in lib/validation.ts. */
const ruled = (name: RuleName) => z.string().nullish().transform((v, ctx) => {
  const rule = RULES[name];
  const problem = check(rule, v);
  if (problem) {
    ctx.addIssue({ code: 'custom', message: problem });
    return z.NEVER;
  }
  const clean = tidy(rule, v);
  return clean && name === 'phone' ? formatPhone(clean) : clean;
});
const pct = z.union([z.literal('').transform(() => null), z.null(), z.coerce.number().int().min(0).max(100)]);
const optInt = z.union([z.literal('').transform(() => null), z.null(), z.undefined().transform(() => null), z.coerce.number().int().min(0)]);
/** Whole rands typed in a form, stored as cents. */
const rands = z.union([z.literal('').transform(() => null), z.null(), z.undefined().transform(() => null), z.coerce.number().min(0).transform((r) => Math.round(r * 100))]);
const yesNo = z.enum(['yes', 'no']).transform((v) => v === 'yes');
/** "2026-10-30" or "2026-10-30T11:00" from a date input, read as SAST. */
const sastInput = z.string().nullish().transform((s, ctx) => {
  if (!s?.trim()) return null;
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
  if (!m) {
    ctx.addIssue({ code: 'custom', message: 'Use a date like 2026-10-30' });
    return z.NEVER;
  }
  return fromSast(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
});
const file = z.instanceof(File).nullish().transform((f) => (f && f.size > 0 ? f : null));

const notFound = (what: string) => new ActionError({ code: 'NOT_FOUND', message: `${what} isn’t there any more.` });

async function bidFor(ocid: string) {
  const [bid] = await db.select().from(schema.bids).where(eq(schema.bids.ocid, ocid));
  if (!bid) throw notFound('That bid');
  return bid;
}

async function docById(id: number) {
  const [doc] = await db.select().from(schema.bidDocuments).where(eq(schema.bidDocuments.id, id));
  if (!doc) throw notFound('That document');
  return doc;
}

/** Saves an upload under data/<folder>/ and returns the path relative to DATA_DIR. */
async function saveFile(folder: string, base: string, f: File): Promise<string> {
  const safe = (s: string) => s.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'file';
  const dir = join(DATA_DIR, folder);
  mkdirSync(dir, { recursive: true });
  const name = `${safe(base)}-${Date.now()}${extname(f.name).toLowerCase() || '.pdf'}`;
  writeFileSync(join(dir, name), Buffer.from(await f.arrayBuffer()));
  return `${folder}/${name}`;
}

export const server = {
  saveSettings: defineAction({
    accept: 'form',
    input: z.object({
      name: ruled('name'), initials: ruled('initials'), registrationNumber: ruled('registrationNumber'),
      csdNumber: ruled('csdNumber'), taxPin: ruled('taxPin'), address: ruled('address'),
      contactPerson: ruled('contactPerson'), phone: ruled('phone'), email: ruled('email'),
      vatRegistered: z.enum(['yes', 'no']), vatNumber: ruled('vatNumber'),
      blackOwnershipPct: pct, womenOwnershipPct: pct, youthOwned: z.enum(['yes', 'no']), province: text,
      alertEmail: ruled('email'), alertMode: z.enum(['instant', 'digest']), alertOnChanges: z.boolean().default(false),
    }).superRefine((d, ctx) => {
      // A VAT number only makes sense for a VAT-registered business, and is needed for one.
      if (d.vatRegistered === 'yes' && !d.vatNumber) {
        ctx.addIssue({ code: 'custom', path: ['vatNumber'], message: 'Enter the VAT number, or choose No above if the business isn’t VAT-registered.' });
      }
    }),
    handler: async (input) => {
      const { alertEmail, alertMode, alertOnChanges, vatRegistered, youthOwned, ...rest } = input;
      const profile = {
        ...rest, vatRegistered: vatRegistered === 'yes', youthOwned: youthOwned === 'yes',
        vatNumber: vatRegistered === 'yes' ? rest.vatNumber : null,
      };
      const alerts = { alertEmail, alertMode, alertOnChanges };
      await db.batch([
        db.insert(schema.companyProfile).values({ id: 1, ...profile }).onConflictDoUpdate({ target: schema.companyProfile.id, set: profile }),
        db.insert(schema.settings).values({ id: 1, ...alerts }).onConflictDoUpdate({ target: schema.settings.id, set: alerts }),
      ]);
      return { saved: true };
    },
  }),

  /** Asks the worker for a fetch now. The worker checks for this file every few seconds. */
  requestFetch: defineAction({
    accept: 'form',
    handler: async () => {
      mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(join(DATA_DIR, 'fetch-requested'), new Date().toISOString());
      return { requested: true };
    },
  }),

  // ---------- Tenders ----------

  startBid: defineAction({
    accept: 'form',
    input: z.object({ ocid: z.string() }),
    handler: async ({ ocid }) => {
      const [t] = await db.select({ entity: schema.tenders.entity }).from(schema.tenders).where(eq(schema.tenders.ocid, ocid));
      if (!t) throw notFound('That tender');
      const existing = await db.select({ id: schema.bids.id }).from(schema.bids).where(eq(schema.bids.ocid, ocid));
      if (existing.length) return { ocid };
      const attachments = await db.select({ title: schema.tenderDocuments.title }).from(schema.tenderDocuments).where(eq(schema.tenderDocuments.ocid, ocid));
      const [bid] = await db.insert(schema.bids).values({ ocid, stage: 'preparing', startedAt: new Date() }).returning({ id: schema.bids.id });
      await db.insert(schema.bidDocuments).values(starterChecklist(t.entity, attachments.map((a) => a.title)).map((d) => ({ ...d, bidId: bid.id })));
      await db.update(schema.tenders).set({ openedAt: new Date() }).where(eq(schema.tenders.ocid, ocid));
      return { ocid };
    },
  }),

  /** "Not for us": hides a tender the keyword rules let through. */
  dismissTender: defineAction({
    accept: 'form',
    input: z.object({ ocid: z.string() }),
    handler: async ({ ocid }) => {
      await db.update(schema.tenders).set({ relevant: false, relevanceReason: 'You marked it as not for you.' }).where(eq(schema.tenders.ocid, ocid));
      return { ocid };
    },
  }),

  /** Details read from the tender document by the user: title, province, briefing, submission, scoring. */
  saveTenderDetails: defineAction({
    accept: 'form',
    input: z.object({
      ocid: z.string(), title: text, province: text, workType: z.enum(['website', 'system', 'design']),
      briefingAt: sastInput, briefingWhere: text, briefingCompulsory: z.boolean().default(false),
      submitMethod: text, submitWhere: text, submitCopies: text,
      funcThreshold: optInt, preferenceSystem: z.enum(['80/20', '90/10', '']).transform((v) => v || null),
    }),
    handler: async ({ ocid, province, ...rest }) => {
      if (province && province !== 'National' && !PROVINCES.includes(province)) throw new ActionError({ code: 'BAD_REQUEST', message: 'Pick a province from the list.' });
      const [t] = await db.select({ province: schema.tenders.province, buyerId: schema.tenders.buyerId }).from(schema.tenders).where(eq(schema.tenders.ocid, ocid));
      if (!t) throw notFound('That tender');
      await db.update(schema.tenders).set({
        ...rest, shortTitle: null, updatedAt: new Date(),
        ...(province !== t.province ? { province, provinceSource: 'confirmed' as const } : {}),
      }).where(eq(schema.tenders.ocid, ocid));
      return { ocid };
    },
  }),

  addCriterion: defineAction({
    accept: 'form',
    input: z.object({ ocid: z.string(), name: z.string().trim().min(1), points: optInt, evidence: text, sourcePage: optInt }),
    handler: async (input) => {
      await db.insert(schema.funcCriteria).values(input);
      return { ocid: input.ocid };
    },
  }),

  removeCriterion: defineAction({
    accept: 'form',
    input: z.object({ id: z.coerce.number().int(), ocid: z.string() }),
    handler: async ({ id, ocid }) => {
      await db.delete(schema.funcCriteria).where(and(eq(schema.funcCriteria.id, id), eq(schema.funcCriteria.ocid, ocid)));
      return { ocid };
    },
  }),

  addGoal: defineAction({
    accept: 'form',
    input: z.object({ ocid: z.string(), name: z.string().trim().min(1), points: optInt, profileField: text, sourcePage: optInt }),
    handler: async (input) => {
      await db.insert(schema.specificGoals).values(input);
      return { ocid: input.ocid };
    },
  }),

  removeGoal: defineAction({
    accept: 'form',
    input: z.object({ id: z.coerce.number().int(), ocid: z.string() }),
    handler: async ({ id, ocid }) => {
      await db.delete(schema.specificGoals).where(and(eq(schema.specificGoals.id, id), eq(schema.specificGoals.ocid, ocid)));
      return { ocid };
    },
  }),

  // ---------- The checklist ----------

  addChecklistItem: defineAction({
    accept: 'form',
    input: z.object({
      ocid: z.string(), group: z.enum(['compliance', 'functionality']), name: z.string().trim().min(1),
      kind: z.enum(['form', 'vault', 'upload']), vaultKind: text, needsSignature: z.boolean().default(false),
    }),
    handler: async ({ ocid, ...item }) => {
      const bid = await bidFor(ocid);
      const [{ last }] = await db.select({ last: max(schema.bidDocuments.sortOrder) }).from(schema.bidDocuments).where(eq(schema.bidDocuments.bidId, bid.id));
      await db.insert(schema.bidDocuments).values({
        ...item, bidId: bid.id, sortOrder: (last ?? 0) + 1,
        formType: item.kind === 'form' ? 'generic' : null, vaultKind: item.kind === 'vault' ? item.vaultKind : null,
      });
      return { ocid };
    },
  }),

  removeChecklistItem: defineAction({
    accept: 'form',
    input: z.object({ id: z.coerce.number().int(), ocid: z.string() }),
    handler: async ({ id, ocid }) => {
      const bid = await bidFor(ocid);
      await db.delete(schema.bidDocuments).where(and(eq(schema.bidDocuments.id, id), eq(schema.bidDocuments.bidId, bid.id)));
      return { ocid };
    },
  }),

  /** Generic and disclosure forms, and SBD 6.1 claims: saved answers, marked done. */
  saveForm: defineAction({
    accept: 'form',
    input: z.object({
      id: z.coerce.number().int(), ocid: z.string(),
      q0: yesNo.optional(), q1: yesNo.optional(), q2: yesNo.optional(),
      claims: z.array(z.coerce.number().int()),
    }),
    handler: async ({ id, ocid, q0, q1, q2, claims }) => {
      const doc = await docById(id);
      const data = doc.formType === 'disclosure' ? { answers: [q0 ?? false, q1 ?? false, q2 ?? false] }
        : doc.formType === 'sbd61' ? { claims: claims ?? [] }
        : {};
      await db.update(schema.bidDocuments).set({ done: true, formDataJson: JSON.stringify(data) }).where(eq(schema.bidDocuments.id, id));
      return { ocid };
    },
  }),

  /** Points a form at its pages in the tender's own PDF, so the pack includes them for signing. */
  saveFormSource: defineAction({
    accept: 'form',
    input: z.object({
      id: z.coerce.number().int(), ocid: z.string(),
      docId: z.union([z.literal('').transform(() => null), z.coerce.number().int()]),
      from: optInt, to: optInt,
    }),
    handler: async ({ id, ocid, docId, from, to }) => {
      const doc = await docById(id);
      const data = doc.formDataJson ? JSON.parse(doc.formDataJson) : {};
      if (docId && from) {
        if (to !== null && to < from) throw new ActionError({ code: 'BAD_REQUEST', message: 'The last page comes before the first.' });
        data.source = { docId, from, to: to ?? from };
      } else delete data.source;
      await db.update(schema.bidDocuments).set({ formDataJson: JSON.stringify(data) }).where(eq(schema.bidDocuments.id, id));
      return { ocid, stay: true };
    },
  }),

  /** An upload for a checklist item: the user's own document, saved under data/tenders/. */
  uploadBidFile: defineAction({
    accept: 'form',
    input: z.object({ id: z.coerce.number().int(), ocid: z.string(), file }),
    handler: async ({ id, ocid, file }) => {
      const doc = await docById(id);
      if (!file) throw new ActionError({ code: 'BAD_REQUEST', message: 'Choose a file to upload.' });
      const path = await saveFile(`tenders/${ocid}`, doc.name, file);
      await db.update(schema.bidDocuments).set({ done: true, filePath: path }).where(eq(schema.bidDocuments.id, id));
      return { ocid };
    },
  }),

  markUndone: defineAction({
    accept: 'form',
    input: z.object({ id: z.coerce.number().int(), ocid: z.string() }),
    handler: async ({ id, ocid }) => {
      await db.update(schema.bidDocuments).set({ done: false }).where(eq(schema.bidDocuments.id, id));
      return { ocid };
    },
  }),

  /** The pricing schedule: replaces every line, and marks the pricing form done once it has a total. */
  savePricing: defineAction({
    accept: 'form',
    input: z.object({
      ocid: z.string(), id: z.coerce.number().int(),
      lines: z.string().transform((s, ctx) => {
        try {
          return z.array(z.object({ label: z.string().trim().min(1), quantity: z.number().int().min(1), unitPriceCents: z.number().int().min(0).nullable() })).parse(JSON.parse(s));
        } catch {
          ctx.addIssue({ code: 'custom', message: 'Every line needs a description and a quantity of at least 1.' });
          return z.NEVER;
        }
      }),
    }),
    handler: async ({ ocid, id, lines }) => {
      const bid = await bidFor(ocid);
      await db.delete(schema.pricingLines).where(eq(schema.pricingLines.bidId, bid.id));
      if (lines.length) await db.insert(schema.pricingLines).values(lines.map((l, i) => ({ ...l, bidId: bid.id, sortOrder: i })));
      const priced = lines.some((l) => (l.unitPriceCents ?? 0) > 0);
      await db.update(schema.bidDocuments).set({ done: priced }).where(eq(schema.bidDocuments.id, id));
      return { ocid };
    },
  }),

  // ---------- Submit and result ----------

  markSubmitted: defineAction({
    accept: 'form',
    input: z.object({ ocid: z.string(), submittedAt: sastInput, submitMethod: text, finalPrice: rands }),
    handler: async ({ ocid, submittedAt, submitMethod, finalPrice }) => {
      const bid = await bidFor(ocid);
      await db.update(schema.bids).set({ stage: 'submitted', submittedAt: submittedAt ?? new Date(), submitMethod, finalPriceCents: finalPrice })
        .where(eq(schema.bids.id, bid.id));
      return { ocid };
    },
  }),

  /** Won or lost: the bid closes, and the prices go into the price history as a bid register. */
  recordResult: defineAction({
    accept: 'form',
    input: z.object({ ocid: z.string(), result: z.enum(['won', 'lost', 'cancelled']), winnerName: text, winningPrice: rands }),
    handler: async ({ ocid, result, winnerName, winningPrice }) => {
      const bid = await bidFor(ocid);
      const [t] = await db.select().from(schema.tenders).where(eq(schema.tenders.ocid, ocid));
      const profile = (await db.select().from(schema.companyProfile).where(eq(schema.companyProfile.id, 1)))[0];
      const lines = await db.select().from(schema.pricingLines).where(eq(schema.pricingLines.bidId, bid.id));
      const mine = bid.finalPriceCents ?? (lines.reduce((a, l) => a + l.quantity * (l.unitPriceCents ?? 0), 0) || null);
      const winning = result === 'won' ? (winningPrice ?? mine) : winningPrice;
      await db.update(schema.bids).set({
        stage: result, result, winnerName: result === 'lost' ? winnerName : null, winningPriceCents: winning, resultRecordedAt: new Date(),
      }).where(eq(schema.bids.id, bid.id));

      // One register per tender: replace it if the result is recorded again.
      const old = await db.select({ id: schema.bidRegisters.id }).from(schema.bidRegisters).where(eq(schema.bidRegisters.ocid, ocid));
      if (old.length) {
        await db.delete(schema.registerBids).where(inArray(schema.registerBids.registerId, old.map((o) => o.id)));
        await db.delete(schema.bidRegisters).where(eq(schema.bidRegisters.ocid, ocid));
      }
      if (result !== 'cancelled') {
        const [reg] = await db.insert(schema.bidRegisters).values({
          entity: t?.entity ?? null, job: t?.title ?? t?.reference ?? null, workType: t?.workType ?? null,
          year: sastYear(t?.closesAt ?? new Date()), ocid, createdAt: new Date(),
        }).returning({ id: schema.bidRegisters.id });
        const rows: (typeof schema.registerBids.$inferInsert)[] = [];
        if (mine) rows.push({ registerId: reg.id, bidder: profile?.name ?? 'You', priceCents: mine, won: result === 'won' });
        if (result === 'lost' && (winnerName || winning)) rows.push({ registerId: reg.id, bidder: winnerName, priceCents: winning, won: true });
        if (rows.length) await db.insert(schema.registerBids).values(rows);
      }
      return { ocid };
    },
  }),

  // ---------- Vault ----------

  saveVaultDoc: defineAction({
    accept: 'form',
    input: z.object({
      id: z.coerce.number().int().optional(), name: z.string().trim().min(1), notes: text,
      issuedAt: sastInput, expiresAt: sastInput, file,
    }),
    handler: async ({ id, name, notes, issuedAt, expiresAt, file }) => {
      let kind: string;
      if (id) {
        const [v] = await db.select().from(schema.vaultDocuments).where(eq(schema.vaultDocuments.id, id));
        if (!v) throw notFound('That document');
        kind = v.kind;
      } else {
        // A new kind from the name: "Professional indemnity cover" -> "professional-indemnity-cover".
        kind = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || `doc-${Date.now()}`;
        const clash = await db.select({ id: schema.vaultDocuments.id }).from(schema.vaultDocuments).where(eq(schema.vaultDocuments.kind, kind));
        if (clash.length) kind = `${kind}-${Date.now()}`;
      }
      const filePath = file ? await saveFile('vault', kind, file) : undefined;
      const values = { name, notes, issuedAt, expiresAt, ...(filePath ? { filePath } : {}) };
      if (id) await db.update(schema.vaultDocuments).set(values).where(eq(schema.vaultDocuments.id, id));
      else await db.insert(schema.vaultDocuments).values({ kind, ...values });
      return { saved: true };
    },
  }),

  // ---------- Prices ----------

  /** A bid register or award notice typed in by hand: who bid what, and who won. */
  addRegister: defineAction({
    accept: 'form',
    input: z.object({
      entity: text, job: z.string().trim().min(1, 'Say what the job was.'), workType: z.enum(['website', 'system', 'design']),
      year: z.coerce.number().int().min(2000).max(2100), winner: z.coerce.number().int().optional(), file,
      // Plain arrays, so Astro collects every row of the repeated fields.
      bidder: z.array(z.string()),
      price: z.array(z.string()),
    }),
    handler: async ({ entity, job, workType, year, winner, file, bidder, price }) => {
      const rows = bidder.map((b, i) => ({ bidder: b.trim() || null, rands: Number(String(price[i] ?? '').replace(/[^\d.]/g, '')), won: winner === i }))
        .filter((r) => r.bidder || r.rands);
      if (!rows.length) throw new ActionError({ code: 'BAD_REQUEST', message: 'Add at least one bidder and price.' });
      if (rows.some((r) => !r.rands)) throw new ActionError({ code: 'BAD_REQUEST', message: 'Every bidder needs a price.' });
      const sourceFile = file ? await saveFile('registers', job, file) : null;
      const [reg] = await db.insert(schema.bidRegisters).values({ entity, job, workType, year, sourceFile, createdAt: new Date() }).returning({ id: schema.bidRegisters.id });
      await db.insert(schema.registerBids).values(rows.map((r) => ({ registerId: reg.id, bidder: r.bidder, priceCents: Math.round(r.rands * 100), won: r.won })));
      return { saved: true };
    },
  }),

  deleteRegister: defineAction({
    accept: 'form',
    input: z.object({ id: z.coerce.number().int() }),
    handler: async ({ id }) => {
      await db.delete(schema.registerBids).where(eq(schema.registerBids.registerId, id));
      await db.delete(schema.bidRegisters).where(eq(schema.bidRegisters.id, id));
      return { deleted: true };
    },
  }),

  // ---------- Tenders list ----------

  saveFilters: defineAction({
    accept: 'form',
    input: z.object({ province: text, work: text, type: text, closing: text }),
    handler: async (f) => {
      const json = JSON.stringify(f);
      await db.insert(schema.settings).values({ id: 1, savedFiltersJson: json }).onConflictDoUpdate({ target: schema.settings.id, set: { savedFiltersJson: json } });
      return f;
    },
  }),
};

