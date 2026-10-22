// Money is stored as integer cents and shown in whole rands, with a non-breaking space between
// thousands so an amount never wraps.
export const VAT_RATE = 0.15;

/** 18400000 -> "R184 000" */
export function rand(cents: number): string {
  const r = Math.round(cents / 100);
  return (r < 0 ? '-R' : 'R') + Math.abs(r).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
}

export function vatOn(subtotalCents: number): number {
  return Math.round(subtotalCents * VAT_RATE);
}
