// The checklist a new bid starts with. PLAN.md has Claude read it from the tender document
// (phase 3); until then a bid starts from the forms nearly every tender asks for, plus any SBD or
// MBD form named in the tender's attachments. The tender page says it's a starting point to check
// against the document, and every item can be removed or added to.
import type { schema } from './db.ts';

type NewDoc = Omit<typeof schema.bidDocuments.$inferInsert, 'bidId'>;

/** Municipalities use MBD forms; national and provincial bodies use SBD forms. */
export function formSeries(entity: string | null): 'SBD' | 'MBD' {
  return /municipal|metropolitan|\bmetro\b|district|city of|city council/i.test(entity ?? '') ? 'MBD' : 'SBD';
}

/** "SBD 6.1 IN TERMS OF PPR2022.docx" -> "SBD 6.1" */
function formNumber(title: string | null): string | null {
  const m = (title ?? '').toUpperCase().match(/\b([SM]BD)\s*-?\s*(\d+(?:\.\d+)?)/);
  return m ? `${m[1]} ${m[2]}` : null;
}

// Forms a tender often attaches beyond the core set, with the names used on the checklist.
const KNOWN_FORMS: Record<string, string> = {
  '2': 'tax clearance requirements',
  '3.1': 'pricing schedule, firm prices',
  '3.2': 'pricing schedule, non-firm prices',
  '3.3': 'pricing schedule, professional services',
  '5': 'national industrial participation programme',
  '6.2': 'local production and content',
  '7.1': 'contract form, purchase of goods',
  '7.2': 'contract form, rendering of services',
  '8': 'past supply chain management practices',
  '9': 'certificate of independent bid determination',
};

export function starterChecklist(entity: string | null, attachmentTitles: (string | null)[]): NewDoc[] {
  const s = formSeries(entity);
  const docs: NewDoc[] = [
    { group: 'compliance', kind: 'form', formType: 'generic', name: `${s} 1, invitation to bid`, needsSignature: true },
    { group: 'compliance', kind: 'form', formType: 'disclosure', name: `${s} 4, bidder’s disclosure`, needsSignature: true },
    { group: 'compliance', kind: 'form', formType: 'sbd61', name: `${s} 6.1, preference points claim`, needsSignature: true },
    { group: 'compliance', kind: 'form', formType: 'pricing', name: 'Pricing schedule', needsSignature: true },
    { group: 'compliance', kind: 'vault', vaultKind: 'csd', name: 'CSD summary report' },
    { group: 'compliance', kind: 'vault', vaultKind: 'tax', name: 'Tax compliance PIN' },
    { group: 'compliance', kind: 'vault', vaultKind: 'bbbee', name: 'B-BBEE certificate or sworn affidavit' },
  ];
  if (s === 'MBD') {
    docs.push(
      { group: 'compliance', kind: 'form', formType: 'disclosure', name: 'MBD 8, past supply chain management practices', needsSignature: true },
      { group: 'compliance', kind: 'form', formType: 'generic', name: 'MBD 9, certificate of independent bid determination', needsSignature: true },
      { group: 'compliance', kind: 'vault', vaultKind: 'rates', name: 'Municipal rates clearance' },
    );
  }
  // Forms the tender attached that aren't in the list yet.
  const have = new Set(docs.map((d) => formNumber(d.name)).filter(Boolean));
  for (const title of attachmentTitles) {
    const n = formNumber(title);
    if (!n || have.has(n)) continue;
    have.add(n);
    const num = n.split(' ')[1];
    const pricing = num.startsWith('3.');
    if (pricing) continue; // the pricing schedule is already on the list
    docs.push({ group: 'compliance', kind: 'form', formType: 'generic', name: `${n}${KNOWN_FORMS[num] ? `, ${KNOWN_FORMS[num]}` : ''}`, needsSignature: true });
  }
  return docs.map((d, i) => ({ ...d, sortOrder: i }));
}

/** Evidence people usually attach for functionality, offered when adding to that list. */
export const FUNCTIONALITY_SUGGESTIONS = [
  { name: 'Company profile', kind: 'upload' as const },
  { name: 'Methodology and project plan', kind: 'upload' as const },
  { name: 'Project list, last 5 years', kind: 'vault' as const, vaultKind: 'projects' },
  { name: 'Client reference letters', kind: 'vault' as const, vaultKind: 'refs' },
  { name: 'CVs of key staff', kind: 'vault' as const, vaultKind: 'cvs' },
];
