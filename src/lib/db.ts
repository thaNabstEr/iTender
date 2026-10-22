import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../db/schema.ts';

export const DATA_DIR = process.env.DATA_DIR ?? './data';
const url = process.env.DATABASE_URL ?? 'file:./data/app.db';

// A local file database needs its folder; Turso URLs don't.
if (url.startsWith('file:')) mkdirSync(dirname(url.slice('file:'.length)), { recursive: true });

export const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
// The app and the worker write to the same file: WAL lets one read while the other writes, and the
// busy timeout makes a writer wait its turn instead of failing with SQLITE_BUSY.
if (url.startsWith('file:')) {
  await client.execute('PRAGMA journal_mode = WAL');
  await client.execute('PRAGMA busy_timeout = 10000');
}
export const db = drizzle(client, { schema });
export { schema };
