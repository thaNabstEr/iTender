// Backups: a consistent copy of the database (VACUUM INTO, safe while the app and worker run) and
// the uploaded files, in data/backups/<date>/. The newest 14 are kept.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { client, DATA_DIR } from './db.ts';

export const KEEP = 14;
const FOLDERS = ['vault', 'tenders', 'registers'];

export function backupsDir(): string {
  return join(DATA_DIR, 'backups');
}

/** Makes one backup and prunes old ones. Returns its folder. */
export async function backup(log: (msg: string) => void = () => {}): Promise<string> {
  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace('T', '_').replace(':', '');
  const dir = join(backupsDir(), stamp);
  mkdirSync(dir, { recursive: true });
  const db = resolve(dir, 'app.db');
  rmSync(db, { force: true });
  await client.execute({ sql: 'VACUUM INTO ?', args: [db] });
  for (const f of FOLDERS) {
    const src = join(DATA_DIR, f);
    if (existsSync(src)) cpSync(src, join(dir, f), { recursive: true });
  }
  const all = readdirSync(backupsDir()).filter((d) => /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(d)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) rmSync(join(backupsDir(), old), { recursive: true, force: true });
  log(`backup: saved ${dir}${all.length > KEEP ? `, removed ${all.length - KEEP} old` : ''}`);
  return dir;
}
