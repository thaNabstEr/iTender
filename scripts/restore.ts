// `npm run restore -- <folder>`: put a backup back. Stop the app and the worker first.
// The current database and files are moved aside to data/before-restore-<time>/, not deleted.
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { basename, join } from 'node:path';

const DATA_DIR = process.env.DATA_DIR ?? './data';
const arg = process.argv[2];
const backups = join(DATA_DIR, 'backups');
if (!arg) {
  const list = existsSync(backups) ? readdirSync(backups).sort().reverse() : [];
  console.log(list.length ? `Backups, newest first:\n${list.map((d) => `  ${d}`).join('\n')}\n\nRestore one with: npm run restore -- ${list[0]}` : 'No backups yet.');
  process.exit(0);
}
const from = existsSync(arg) ? arg : join(backups, basename(arg));
if (!existsSync(join(from, 'app.db'))) {
  console.error(`${from} isn’t a backup: it has no app.db.`);
  process.exit(1);
}
const aside = join(DATA_DIR, `before-restore-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`);
mkdirSync(aside, { recursive: true });
for (const name of ['app.db', 'app.db-wal', 'app.db-shm', 'vault', 'tenders', 'registers']) {
  const p = join(DATA_DIR, name);
  if (existsSync(p)) renameSync(p, join(aside, name));
}
for (const name of ['app.db', 'vault', 'tenders', 'registers']) {
  const p = join(from, name);
  if (existsSync(p)) cpSync(p, join(DATA_DIR, name), { recursive: true });
}
console.log(`Restored ${from}. What was there before is in ${aside}. Start the app and worker again.`);
