import { migrate } from 'drizzle-orm/libsql/migrator';
import { db } from '../src/lib/db.ts';

await migrate(db, { migrationsFolder: './drizzle' });
console.log('Database is up to date.');
