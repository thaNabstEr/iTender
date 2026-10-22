// The scheduled jobs. Runs as its own process, never inside the Astro server.
// It shares the schema and database with the app through src/lib/db.ts.
import cron from 'node-cron';
import { FETCH_DAYTIME_CRON, FETCH_OVERNIGHT_CRON, TIMEZONE } from '../src/lib/schedule.ts';
import { runFetch } from './jobs/fetch.ts';

const log = (msg: string) => console.log(`[worker ${new Date().toISOString()}] ${msg}`);

async function fetchJob(reason: string) {
  log(`fetch (${reason})`);
  try {
    await runFetch(log);
  } catch (err) {
    log(`fetch failed: ${err instanceof Error ? err.stack : String(err)}`);
  }
}

const options = { timezone: TIMEZONE, noOverlap: true };
cron.schedule(FETCH_DAYTIME_CRON, () => fetchJob('weekday schedule'), options);
cron.schedule(FETCH_OVERNIGHT_CRON, () => fetchJob('overnight'), options);

log(`started. Fetches at ${FETCH_DAYTIME_CRON} and ${FETCH_OVERNIGHT_CRON} (${TIMEZONE}).`);
// Catch up from the last successful run on every start.
void fetchJob('catch-up on start');

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => process.exit(0));
