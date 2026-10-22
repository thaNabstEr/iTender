// The suggested price range: the middle half (25th to 75th percentile) of winning bids for the
// same work type. Fewer than 3 winning bids is not enough for a range.
import type { Register } from './desk.ts';

export const MIN_WINS_FOR_RANGE = 3;

export type PricePoint = { priceCents: number; won: boolean };

/** Linear interpolation between closest ranks, on a sorted list. */
export function percentile(sorted: number[], p: number): number {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo));
}

export function suggestedRange(points: PricePoint[]): { lo: number; hi: number } | null {
  const wins = points.filter((p) => p.won).map((p) => p.priceCents).sort((a, b) => a - b);
  if (wins.length < MIN_WINS_FOR_RANGE) return null;
  return { lo: percentile(wins, 0.25), hi: percentile(wins, 0.75) };
}

/** Every recorded bid with a price, for one work type. */
export function pricePoints(registers: Register[], workType: string | null): PricePoint[] {
  return registers
    .filter((r) => r.workType === workType)
    .flatMap((r) => r.bids)
    .filter((b): b is { bidder: string | null; priceCents: number; won: boolean } => b.priceCents !== null);
}
