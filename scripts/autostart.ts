// `npm run autostart -- install`: start the app and the worker at login on macOS, with launchd.
// `npm run autostart -- uninstall` removes them. Logs go to data/logs/. Run `npm run build` first:
// the app runs the built server (dist/), the worker runs from source.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const node = process.execPath;
const agents = join(homedir(), 'Library', 'LaunchAgents');
const logs = join(root, 'data', 'logs');
const jobs = [
  { label: 'za.itender.app', args: [node, '--env-file-if-exists=.env', 'dist/server/entry.mjs'], env: { HOST: '127.0.0.1', PORT: '4321' } },
  { label: 'za.itender.worker', args: [node, '--env-file-if-exists=.env', 'worker/index.ts'], env: {} as Record<string, string> },
];

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const plist = (j: (typeof jobs)[number]) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${j.label}</string>
  <key>ProgramArguments</key><array>${j.args.map((a) => `<string>${xml(a)}</string>`).join('')}</array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>EnvironmentVariables</key><dict>${Object.entries({ TZ: 'Africa/Johannesburg', ...j.env }).map(([k, v]) => `<key>${k}</key><string>${xml(v)}</string>`).join('')}</dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(join(logs, `${j.label.split('.').pop()}.log`))}</string>
  <key>StandardErrorPath</key><string>${xml(join(logs, `${j.label.split('.').pop()}.log`))}</string>
</dict></plist>
`;

const cmd = process.argv[2];
const uid = String(process.getuid?.() ?? '');
const launchctl = (...a: string[]) => { try { execFileSync('launchctl', a, { stdio: 'ignore' }); } catch { /* not loaded */ } };

if (cmd === 'install') {
  if (process.platform !== 'darwin') throw new Error('Autostart uses launchd, so it only works on macOS. Use pm2 elsewhere (see README.md).');
  if (!existsSync(join(root, 'dist', 'server', 'entry.mjs'))) throw new Error('Run `npm run build` first.');
  mkdirSync(agents, { recursive: true });
  mkdirSync(logs, { recursive: true });
  for (const j of jobs) {
    const file = join(agents, `${j.label}.plist`);
    launchctl('bootout', `gui/${uid}`, file);
    writeFileSync(file, plist(j));
    launchctl('bootstrap', `gui/${uid}`, file);
    console.log(`Installed and started ${j.label} (${file})`);
  }
  console.log(`iTender now starts at login: http://127.0.0.1:4321. Logs: ${logs}`);
} else if (cmd === 'uninstall') {
  for (const j of jobs) {
    const file = join(agents, `${j.label}.plist`);
    launchctl('bootout', `gui/${uid}`, file);
    rmSync(file, { force: true });
    console.log(`Removed ${j.label}`);
  }
} else {
  console.log('Usage: npm run autostart -- install | uninstall');
}
