<script lang="ts">
  // Past bids on one line: won as filled dots, lost as open ones, the suggested range shaded,
  // and your bid as a bar. Rendered on the server for Prices; hydrated in the pricing calculator.
  import { rand } from '../../lib/money.ts';
  import type { PricePoint } from '../../lib/prices.ts';

  interface Props {
    points: PricePoint[];
    range: { lo: number; hi: number } | null;
    mine?: number | null;
  }
  let { points, range, mine = null }: Props = $props();

  const STEP = 5_000_000; // R50k, in cents
  const k = (c: number) => `R${Math.round(c / 100_000)}k`;

  let values = $derived([...points.map((p) => p.priceCents), ...(range ? [range.lo, range.hi] : []), ...(mine ? [mine] : [])]);
  let min = $derived(Math.floor(Math.min(...values) / STEP) * STEP);
  let max = $derived(Math.max(Math.ceil(Math.max(...values) / STEP) * STEP, min + STEP));
  let x = $derived((c: number) => 20 + ((Math.min(Math.max(c, min), max) - min) / (max - min)) * 480);
  let axisY = $derived(mine ? 124 : 112);
  let label = $derived(
    `${points.length} past ${points.length === 1 ? 'bid' : 'bids'}` +
      (range ? `, with a suggested range of ${rand(range.lo)} to ${rand(range.hi)}` : '') +
      (mine ? `. Your bid is ${rand(mine)}` : ''),
  );
</script>

{#if points.length}
  <svg role="img" aria-label={label} viewBox="0 0 520 150" style="width:100%;height:auto;display:block">
    {#if range}
      <rect x={x(range.lo)} y="40" width={Math.max(x(range.hi) - x(range.lo), 4)} height="44" rx="6" fill="var(--range)" />
      <text x={(x(range.lo) + x(range.hi)) / 2} y="30" text-anchor="middle" font-size="13" font-weight="700" fill="var(--forest)">Suggested range {rand(range.lo)} to {rand(range.hi)}</text>
    {/if}
    <line x1="20" y1="62" x2="500" y2="62" stroke="var(--control)" stroke-width="1.5" />
    {#each points as p}
      {#if p.won}
        <circle cx={x(p.priceCents)} cy="62" r="6.5" fill="var(--ink)" />
      {:else}
        <circle cx={x(p.priceCents)} cy="62" r="5" fill="var(--page)" stroke="var(--muted)" stroke-width="1.5" />
      {/if}
    {/each}
    {#if mine}
      <line x1={x(mine)} y1="36" x2={x(mine)} y2="88" stroke="var(--forest)" stroke-width="3" />
      <text x={x(mine)} y="104" text-anchor="middle" font-size="12" font-weight="700" fill="var(--forest)">Your bid {rand(mine)}</text>
    {/if}
    <text x="20" y={axisY} font-size="12" fill="var(--muted)">{k(min)}</text>
    <text x="500" y={axisY} text-anchor="end" font-size="12" fill="var(--muted)">{k(max)}</text>
    <circle cx="24" cy="140" r="5" fill="var(--ink)" /><text x="36" y="144" font-size="12" fill="var(--ink)">Won</text>
    <circle cx="88" cy="140" r="5" fill="var(--page)" stroke="var(--muted)" stroke-width="1.5" /><text x="100" y="144" font-size="12" fill="var(--ink)">Lost</text>
  </svg>
{/if}
