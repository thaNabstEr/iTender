// A calendar file with the closing time and, if there is one, the briefing. Written by hand:
// two events don't need the ics package.
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../../lib/db.ts';
import { APP_URL } from '../../../lib/email.ts';

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
// Lines are folded at 75 characters, and text escapes commas, semicolons and backslashes.
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const fold = (line: string) => line.match(/.{1,74}/g)!.join('\r\n ');

export const GET: APIRoute = async ({ params }) => {
  const ocid = params.ocid!;
  const [t] = await db.select().from(schema.tenders).where(eq(schema.tenders.ocid, ocid));
  if (!t) return new Response('Not found', { status: 404 });
  const name = t.title ?? t.reference ?? 'Tender';
  const url = `${APP_URL}/tenders/${encodeURIComponent(ocid)}`;
  const events: string[][] = [];
  if (t.closesAt) {
    events.push([
      `UID:${ocid}-closes@itender`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(t.closesAt)}`, `DTEND:${stamp(t.closesAt)}`,
      `SUMMARY:${esc(`Closes: ${name}`)}`, `DESCRIPTION:${esc(`${t.entity ?? ''}. ${t.submitMethod ? `Submit by ${t.submitMethod.toLowerCase()}. ` : ''}${url}`)}`,
      ...(t.submitWhere ? [`LOCATION:${esc(t.submitWhere)}`] : []),
      'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', `DESCRIPTION:${esc(`${name} closes tomorrow`)}`, 'END:VALARM',
    ]);
  }
  if (t.briefingAt) {
    events.push([
      `UID:${ocid}-briefing@itender`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(t.briefingAt)}`, `DTEND:${stamp(new Date(t.briefingAt.getTime() + 3600_000))}`,
      `SUMMARY:${esc(`${t.briefingCompulsory ? 'Compulsory briefing' : 'Briefing'}: ${name}`)}`, `DESCRIPTION:${esc(url)}`,
      ...(t.briefingWhere ? [`LOCATION:${esc(t.briefingWhere)}`] : []),
      'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', `DESCRIPTION:${esc(`Briefing for ${name}`)}`, 'END:VALARM',
    ]);
  }
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//iTender//EN', 'CALSCALE:GREGORIAN',
    ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].map(fold).join('\r\n');
  const file = name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'tender';
  return new Response(body + '\r\n', {
    headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': `attachment; filename="${file}.ics"` },
  });
};
