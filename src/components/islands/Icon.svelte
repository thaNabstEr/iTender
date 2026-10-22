<script lang="ts">
  // The Svelte twin of Icon.astro: draws a Hugeicons free icon from its path data.
  type IconData = readonly (readonly [string, { readonly [key: string]: string | number }])[];
  interface Props {
    icon: IconData;
    size?: number;
  }
  let { icon, size = 20 }: Props = $props();
  const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style="flex-shrink:0">
  {#each icon as [tag, attrs]}
    <svelte:element this={tag} {...Object.fromEntries(Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => [kebab(k), v]))} />
  {/each}
</svg>
