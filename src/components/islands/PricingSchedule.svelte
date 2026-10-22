<script lang="ts">
  // The pricing schedule: editable lines with live totals, with or without VAT, against the price
  // band from past bids. Posts every line as JSON to the savePricing action.
  import PriceBand from './PriceBand.svelte';
  import Icon from './Icon.svelte';
  import { Delete02Icon } from '@hugeicons/core-free-icons';
  import { rand, vatOn } from '../../lib/money.ts';
  import type { PricePoint } from '../../lib/prices.ts';

  type Line = { label: string; quantity: number; unitPriceCents: number | null };
  interface Props {
    action: string;
    ocid: string;
    id: number;
    lines: Line[];
    vat: boolean;
    points: PricePoint[];
    range: { lo: number; hi: number } | null;
  }
  let { action, ocid, id, lines: initial, vat, points, range }: Props = $props();

  // Rands in the inputs, cents in the data.
  let rows = $state(
    (initial.length ? initial : [{ label: '', quantity: 1, unitPriceCents: null }]).map((l) => ({
      label: l.label,
      quantity: l.quantity,
      unit: l.unitPriceCents === null ? '' : String(l.unitPriceCents / 100),
    })),
  );

  const cents = (s: string) => (s.trim() === '' || isNaN(Number(s)) ? null : Math.round(Number(s) * 100));
  let subtotal = $derived(rows.reduce((a, r) => a + (Number(r.quantity) || 0) * (cents(r.unit) ?? 0), 0));
  let vatCents = $derived(vat ? vatOn(subtotal) : 0);
  let total = $derived(subtotal + vatCents);
  let json = $derived(
    JSON.stringify(
      rows
        .filter((r) => r.label.trim())
        .map((r) => ({ label: r.label.trim(), quantity: Math.max(1, Math.round(Number(r.quantity) || 1)), unitPriceCents: cents(r.unit) })),
    ),
  );
  let position = $derived.by(() => {
    if (!range || !total) return '';
    if (total < range.lo) return `${rand(range.lo - total)} below the suggested range.`;
    if (total > range.hi) return `${rand(total - range.hi)} above the suggested range.`;
    return 'Inside the suggested range.';
  });

  function add() {
    rows.push({ label: '', quantity: 1, unit: '' });
  }
  function remove(i: number) {
    rows.splice(i, 1);
    if (!rows.length) add();
  }
</script>

<div class="cols">
  <!-- Full width, so the table never scrolls sideways; the price band sits below it. -->
  <section style="flex-basis:100%">
    <form method="POST" {action}>
      <input type="hidden" name="ocid" value={ocid} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="lines" value={json} />
      <div class="tablebox">
        <table style="min-width:560px">
          <thead><tr><th class="col-number">#</th><th>Item</th><th>Qty</th><th>Unit price, R</th><th class="col-actions">Actions</th></tr></thead>
          <tbody>
            {#each rows as row, i}
              <tr>
                <td class="col-number">{i + 1}</td>
                <td><input type="text" bind:value={row.label} placeholder="What the line is for" aria-label="Item {i + 1}" style="width:100%" /></td>
                <td class="num" style="width:90px"><input type="number" min="1" step="1" placeholder="1" bind:value={row.quantity} aria-label="Quantity for item {i + 1}" style="width:80px" /></td>
                <td class="num" style="width:160px"><input type="number" min="0" step="0.01" bind:value={row.unit} placeholder="0" aria-label="Unit price for item {i + 1}" style="width:150px" /></td>
                <td class="col-actions"><button type="button" class="btn small with-icon" onclick={() => remove(i)} aria-label="Remove item {i + 1}"><Icon icon={Delete02Icon} size={16} />Remove</button></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p style="margin:12px 0 0"><button type="button" class="link" onclick={add}>Add a Line</button></p>
      <div class="sum">
        <span class="sub">Subtotal</span><span class="num">{rand(subtotal)}</span>
        {#if vat}<span class="sub">VAT at 15%</span><span class="num">{rand(vatCents)}</span>{/if}
        <span style="font-weight:700;align-self:end">Total</span><span class="total num">{rand(total)}</span>
      </div>
      {#if position}<p style="margin:16px 0 0">{position}</p>{/if}
      <div class="actions" style="padding-top:24px"><button type="submit" class="primary">Save Price and Mark Done</button></div>
    </form>
  </section>
  <section>
    <h2>What similar jobs went for</h2>
    {#if points.length}
      <p style="margin:0 0 20px">{range ? `Winners bid between ${rand(range.lo)} and ${rand(range.hi)}.` : 'Not enough winning bids for a range yet.'}</p>
      <PriceBand {points} {range} mine={total || null} />
    {:else}
      <p style="margin:0">No past prices for this kind of job yet. Record results in My bids and they show here.</p>
    {/if}
  </section>
</div>

<style>
  .sum {
    padding: 20px 0 0;
    display: grid;
    grid-template-columns: auto auto;
    gap: 4px 24px;
    justify-content: start;
    font-variant-numeric: tabular-nums;
  }
</style>
