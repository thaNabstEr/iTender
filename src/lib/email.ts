// Alert emails, laid out like reference/iTender emails.html: a white card on soft green, the
// iTender wordmark, a big forest heading, one range-green or forest panel, a lime button.
//
// Sending is logged for now: each email is written to data/outbox/ as an HTML file, and the
// worker log says so. Nodemailer with Gmail SMTP slots into `send` later.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './db.ts';

export const APP_URL = (process.env.APP_URL ?? 'http://127.0.0.1:4321').replace(/\/$/, '');

export interface Email {
  kind: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

const esc = (s: string | null | undefined) =>
  (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const C = { soft: '#F5F7F3', ink: '#0E0F0C', muted: '#5D6159', line: '#E8EBE6', forest: '#163300', lime: '#9FE870', mark: '#CDFFAD', range: '#E2F6D5' };
const FONT = `'Inter', Helvetica, Arial, sans-serif`;

export function link(path: string): string {
  return `${APP_URL}${path}`;
}

export function button(href: string, label: string): string {
  return `<a href="${esc(href)}" style="display:inline-block;background:${C.lime};color:${C.forest};font-weight:700;font-size:15px;text-decoration:none;padding:13px 26px;border-radius:9999px">${esc(label)}</a>`;
}

export function heading(title: string, lede: string): string {
  return `<div style="padding:36px 40px 8px">
<h1 style="margin:0 0 16px;font-size:40px;line-height:1.02;font-weight:900;letter-spacing:-0.035em;color:${C.forest}">${esc(title)}</h1>
<p style="margin:0 0 28px;font-size:17px">${esc(lede)}</p>
</div>`;
}

/** The range-green panel of facts: label above, value below. */
export function facts(items: [string, string][], opts: { big?: boolean; struck?: number } = {}): string {
  const cells = items.map(([label, value], i) => `<td style="padding:0 36px 8px 0;vertical-align:top;white-space:nowrap">
<div style="font-size:14px;opacity:0.8">${esc(label)}</div>
<div style="font-size:${opts.big ? 22 : 14}px;font-weight:${opts.big ? (i === opts.struck ? 400 : 900) : 700};${i === opts.struck ? 'text-decoration:line-through;text-decoration-thickness:2px;' : ''}">${esc(value)}</div>
</td>`).join('');
  return `<div style="margin:0 24px;padding:28px 32px;border-radius:24px;color:${C.forest};background-color:${C.range}">
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;color:${C.forest}"><tr>${cells}</tr></table>
</div>`;
}

export function section(title: string, body: string): string {
  return `<h2 style="margin:0 0 6px;font-size:17px;font-weight:800">${esc(title)}</h2>
<p style="margin:0 0 20px">${esc(body)}</p>`;
}

/** A list row: bold name with a grey line under it, and a right-aligned note. */
export function row(name: string, href: string | null, sub: string, right: string, rightMarked = false): string {
  const title = href
    ? `<a href="${esc(href)}" style="font-weight:700;text-decoration:none;color:${C.ink}">${esc(name)}</a>`
    : `<div style="font-weight:700">${esc(name)}</div>`;
  const note = rightMarked ? `<span style="background:${C.mark};padding:1px 8px;border-radius:9999px;font-weight:700">${esc(right)}</span>` : esc(right);
  return `<tr><td style="padding:14px 16px 14px 0;border-bottom:1px solid ${C.line};vertical-align:top">${title}<div style="font-size:13px;color:${C.muted}">${esc(sub)}</div></td>
<td style="padding:14px 0;border-bottom:1px solid ${C.line};font-size:14px;text-align:right;white-space:nowrap;vertical-align:top">${note}</td></tr>`;
}

export function rows(items: string[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-top:1px solid ${C.line}">${items.join('')}</table>`;
}

/** The whole email: wordmark (with an optional date on the right), body, and the footer lines. */
export function layout(body: string, footer: string, date?: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:${C.soft}">
<div style="padding:40px 16px;background:${C.soft};font-family:${FONT};color:${C.ink};font-size:15px;line-height:1.5">
<div style="max-width:600px;margin:0 auto;background:#FFFFFF;border-radius:24px;overflow:hidden">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
<td style="padding:28px 40px 0;font-size:22px;font-weight:900;letter-spacing:-0.03em;color:${C.forest}">iTender</td>
${date ? `<td style="padding:28px 40px 0;font-size:13px;color:${C.muted};text-align:right">${esc(date)}</td>` : ''}
</tr></table>
${body}
<div style="margin-top:32px;padding:24px 40px 32px;border-top:1px solid ${C.line};font-size:13px;color:${C.muted}">
<p style="margin:0 0 8px">${esc(footer)}</p>
<p style="margin:0">Links open iTender on your laptop, so they work there.</p>
</div>
</div>
</div>
</body></html>`;
}

export function pad(html: string, top = 28): string {
  return `<div style="padding:${top}px 40px 8px">${html}</div>`;
}

export function forestPanel(big: string, text: string, href: string, label: string): string {
  return `<div style="margin:28px 24px 0;padding:28px 32px;background:${C.forest};border-radius:24px;color:#FFFFFF">
<p style="margin:0 0 4px;font-size:28px;line-height:1.1;font-weight:900;letter-spacing:-0.03em;color:${C.lime}">${esc(big)}</p>
<p style="margin:0 0 20px;font-size:16px">${esc(text)}</p>
${button(href, label)}
</div>`;
}

export function hugeFigure(figure: string, lede: string): string {
  return `<p style="margin:0 0 6px;font-size:64px;line-height:0.95;font-weight:900;letter-spacing:-0.045em;color:${C.forest}">${esc(figure)}</p>
<p style="margin:0 0 20px;font-size:16px">${esc(lede)}</p>`;
}

/** Plain text from the HTML, for the text part of the email. */
export function textOf(html: string): string {
  return html
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs, '$2 ($1)')
    .replace(/<(br|\/p|\/h1|\/h2|\/tr|\/div)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

const isEmail = (s: string | null | undefined): s is string => !!s && /^[^\s@\[\]]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/** Where alerts go: the address in Settings if it's a real one, then ALERT_TO from .env. */
export function recipient(settingsEmail: string | null | undefined): string | null {
  if (isEmail(settingsEmail)) return settingsEmail.trim();
  const env = process.env.ALERT_TO;
  return isEmail(env) ? env.trim() : null;
}

let sentCount = 0;

/** "Sends" an email: writes it to data/outbox/ and logs it. Returns the file path. */
export function send(email: Email, log: (msg: string) => void): string {
  const dir = join(DATA_DIR, 'outbox');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(dir, `${stamp}-${String(++sentCount).padStart(3, '0')}-${email.kind}.html`);
  writeFileSync(file, `<!-- To: ${email.to}\n     Subject: ${email.subject} -->\n${email.html}`);
  log(`email (logged, not sent) to ${email.to}: "${email.subject}" -> ${file}`);
  return file;
}
