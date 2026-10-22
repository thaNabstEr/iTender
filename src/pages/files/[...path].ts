// Serves uploaded files: vault documents, bid uploads and bid registers under DATA_DIR. Nothing else in data/
// (the database, backups) is reachable, and paths can't climb out of their folder.
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import type { APIRoute } from 'astro';
import { DATA_DIR } from '../../lib/db.ts';

const TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

export const GET: APIRoute = async ({ params }) => {
  const rel = normalize(params.path ?? '');
  if (rel.startsWith('..') || !/^(vault|tenders|registers)\//.test(rel)) return new Response('Not found', { status: 404 });
  try {
    const body = await readFile(join(DATA_DIR, rel));
    const name = rel.split('/').pop()!;
    return new Response(body, {
      headers: { 'content-type': TYPES[extname(rel).toLowerCase()] ?? 'application/octet-stream', 'content-disposition': `inline; filename="${name}"` },
    });
  } catch {
    return new Response('That file isn’t there. It may have been moved or deleted from data/.', { status: 404 });
  }
};
