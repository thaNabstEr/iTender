// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import svelte from '@astrojs/svelte';

// There is no login, so the app must only ever listen on this machine.
const host = '127.0.0.1';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [svelte()],
  server: { host, port: 4321 },
  vite: { server: { host } },
  devToolbar: { enabled: false },
});
