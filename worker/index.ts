// The scheduled jobs. Runs as its own process, never inside the Astro server.
// It shares the schema and database with the app through src/lib/db.ts.
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import cron from 'node-cron';
import { DATA_DIR } from '../src/lib/db.ts';
import { BACKUP_CRON, DIGEST_CRON, FETCH_DAYTIME_CRON, FETCH_OVERNIGHT_CRON, REMINDERS_CRON, TIMEZONE } from '../src/lib/schedule.ts';
import { backup } from '../src/lib/backup.ts';
import { runFetch } from './jobs/fetch.ts';
import { sendChanges, sendNewTenders, sendReminders } from './jobs/alerts.ts';
import { convertWaitingWordFiles, saveTenderDocuments } from './jobs/documents.ts';

const log = (msg: string) => console.log(`[worker ${new Date().toISOString()}] ${msg}`);
const quiet = !process.argv.includes('--verbose');

async function job(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    log(`${name} failed: ${err instanceof Error ? err.stack : String(err)}`);
  }
}

// One fetch at a time: a fetch asked for while one runs waits for it, then runs once.
let running: Promise<void> | null = null;
let again = false;
function fetchJob(reason: string, recheckAll = false): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    log(`fetch (${reason})`);
    await job('fetch', () => runFetch(log, { recheckAll, quiet }));
    // New tenders (instant mode) and changes to bids go out straight after each fetch.
    await job('new tender alerts', () => sendNewTenders(log));
    await job('change alerts', () => sendChanges(log));
  })().finally(() => {
    running = null;
    if (again) {
      again = false;
      void fetchJob('asked for during the last one');
    }
  });
  return running;
}

const options = { timezone: TIMEZONE, noOverlap: true };
cron.schedule(FETCH_DAYTIME_CRON, () => fetchJob('weekday schedule'), options);
// Overnight also re-reads every open relevant tender for addenda and new closing dates.
cron.schedule(FETCH_OVERNIGHT_CRON, () => fetchJob('overnight', true), options);
cron.schedule(DIGEST_CRON, () => job('digest', () => sendNewTenders(log, { digest: true })), options);
cron.schedule(REMINDERS_CRON, () => job('reminders', () => sendReminders(log)), options);
cron.schedule(BACKUP_CRON, () => job('backup', () => backup(log)), options);

// Every few seconds: a "Fetch now" from the app (it leaves this file), and documents to save for
// newly started bids.
const REQUEST = join(DATA_DIR, 'fetch-requested');
let saving = false;
setInterval(() => {
  if (existsSync(REQUEST)) {
    rmSync(REQUEST, { force: true });
    void fetchJob('asked for in the app');
  }
  if (saving) return;
  saving = true;
  void job('documents', () => saveTenderDocuments(log).then(() => undefined)).finally(() => (saving = false));
}, 5000);
void job('converting Word files', () => convertWaitingWordFiles(log));

log(`started. Fetches at ${FETCH_DAYTIME_CRON} and ${FETCH_OVERNIGHT_CRON}, digest at ${DIGEST_CRON}, reminders at ${REMINDERS_CRON}, backup at ${BACKUP_CRON} (${TIMEZONE}).`);
// Catch up from the last successful run on every start.
void fetchJob('catch-up on start');

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => process.exit(0));
