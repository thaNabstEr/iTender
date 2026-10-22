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
export const db = drizzle(client, { schema });
export { schema };
