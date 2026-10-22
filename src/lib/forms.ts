// Filling forms from what's already known: the profile, and answers given last time.
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from './db.ts';
import type { Goal, Profile } from './desk.ts';

export const DISCLOSURE_QUESTIONS = [
  'Is any director, owner or shareholder employed by the state?',
  'Is anyone in the business related to a person employed by this institution?',
  'Does any director have an interest in another business bidding on this tender?',
];

/** The last answers given on a disclosure form, to fill the next one. */
export async function lastDisclosureAnswers(): Promise<boolean[] | null> {
  const rows = await db.select({ json: schema.bidDocuments.formDataJson }).from(schema.bidDocuments)
    .where(and(eq(schema.bidDocuments.formType, 'disclosure'), eq(schema.bidDocuments.done, true)))
    .orderBy(desc(schema.bidDocuments.id)).limit(1);
  const answers = rows[0]?.json ? JSON.parse(rows[0].json).answers : null;
  return Array.isArray(answers) ? answers : null;
}

/** What a specific goal can be claimed from in the profile. */
export const GOAL_FIELDS = {
  blackOwnershipPct: 'Black ownership of 51% or more',
  womenOwnershipPct: 'Women ownership of 51% or more',
  youthOwned: 'Youth owned',
  local: 'Based in the tender’s province',
} as const;

/** Whether the profile supports claiming a goal. Unknown fields aren't claimed. */
export function profileClaims(g: Goal, p: Profile | null, tenderProvince: string | null): boolean {
  if (!p) return false;
  switch (g.profileField) {
    case 'blackOwnershipPct': return (p.blackOwnershipPct ?? 0) >= 51;
    case 'womenOwnershipPct': return (p.womenOwnershipPct ?? 0) >= 51;
    case 'youthOwned': return p.youthOwned;
    case 'local': return !!p.province && p.province === tenderProvince;
    default: return false;
  }
}
