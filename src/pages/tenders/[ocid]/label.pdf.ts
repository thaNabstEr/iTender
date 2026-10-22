// The envelope label for tender-box submissions.
import type { APIRoute } from 'astro';
import { buildLabel } from '../../../lib/pack.ts';

export const GET: APIRoute = async ({ params, locals }) => {
  const desk = await locals.desk();
  const t = desk.tenders.find((x) => x.ocid === params.ocid);
  if (!t) return new Response('Not found', { status: 404 });
  return new Response(Buffer.from(await buildLabel(desk, t)), { headers: { 'content-type': 'application/pdf', 'content-disposition': 'inline; filename="envelope-label.pdf"' } });
};
