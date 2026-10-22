// The bid pack as one PDF: final when every document is ready, a draft with placeholders otherwise.
import type { APIRoute } from 'astro';
import { buildPack, packParts } from '../../../lib/pack.ts';

export const GET: APIRoute = async ({ params, locals }) => {
  const desk = await locals.desk();
  const t = desk.tenders.find((x) => x.ocid === params.ocid);
  if (!t?.bid) return new Response('Not found', { status: 404 });
  const parts = await packParts(desk, t);
  const bytes = await buildPack(desk, t, parts);
  const draft = parts.some((p) => !p.ready);
  const name = `${(t.reference ?? t.title ?? 'bid').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60)}-${draft ? 'draft' : 'bid-pack'}.pdf`;
  return new Response(Buffer.from(bytes), { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${name}"` } });
};
