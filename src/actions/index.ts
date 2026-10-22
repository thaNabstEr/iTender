import { defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { db, schema } from '../lib/db.ts';

// Empty and missing fields are both stored as null.
const text = z.string().nullish().transform((s) => s?.trim() || null);
const pct = z.union([z.literal('').transform(() => null), z.null(), z.coerce.number().int().min(0).max(100)]);

export const server = {
  saveSettings: defineAction({
    accept: 'form',
    input: z.object({
      name: text, initials: text, registrationNumber: text, csdNumber: text, taxPin: text,
      address: text, contactPerson: text, phone: text, email: text,
      vatRegistered: z.enum(['yes', 'no']), vatNumber: text,
      blackOwnershipPct: pct, womenOwnershipPct: pct, youthOwned: z.enum(['yes', 'no']), province: text,
      alertEmail: text, alertMode: z.enum(['instant', 'digest']), alertOnChanges: z.boolean().default(false),
    }),
    handler: async (input) => {
      const { alertEmail, alertMode, alertOnChanges, vatRegistered, youthOwned, ...rest } = input;
      const profile = { ...rest, vatRegistered: vatRegistered === 'yes', youthOwned: youthOwned === 'yes' };
      const alerts = { alertEmail, alertMode, alertOnChanges };
      await db.batch([
        db.insert(schema.companyProfile).values({ id: 1, ...profile }).onConflictDoUpdate({ target: schema.companyProfile.id, set: profile }),
        db.insert(schema.settings).values({ id: 1, ...alerts }).onConflictDoUpdate({ target: schema.settings.id, set: alerts }),
      ]);
      return { saved: true };
    },
  }),
};
