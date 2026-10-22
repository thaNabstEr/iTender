# iTender

A tender desk for one small South African business that bids on government website, systems and
design work. It finds new tenders on eTenders, builds the checklist and bid pack for each one,
tracks bids from start to result, and keeps a price history from past bids.

It runs on one laptop and listens on 127.0.0.1 only. There is no login, so never expose it to a
network.

## Setup

Needs Node 24 or later.

```sh
npm install
cp .env.example .env      # then fill in what you use (see below)
npm run db:migrate        # creates data/app.db
npm run dev               # the app on http://127.0.0.1:4321 and the worker, together
```

The worker catches up on start: the first run fetches the last 14 days from eTenders, which takes
a few minutes. Fill in Settings (company profile, VAT, ownership, alert email) before your first
bid; every form is filled from it.

Optional:

- **LibreOffice**, to convert DOC and DOCX tender documents to PDF (`brew install --cask libreoffice`).
  Without it they're saved and flagged to open in Word.
- **Blank official forms** in `tender-desk-kit/reference/forms/` named by number (`SBD-4.pdf`,
  `MBD-6.1.pdf`). The bid pack adds them after the filled sheet when the tender has no own form.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | App and worker together, for day-to-day use and development |
| `npm run worker` | The worker on its own |
| `npm run fetch:once` | One fetch now, printing what was added, updated and skipped. Add `-- --recheck` to re-read every open tender, `-- --verbose` for every request |
| `npm run backup` | Copy the database and uploaded files to `data/backups/<date>/` |
| `npm run restore` | List backups; `npm run restore -- <folder>` puts one back |
| `npm run build` / `npm start` | Build and run the app without the dev server |
| `npm run autostart -- install` | Start the app and worker at login (macOS); `uninstall` removes it |
| `npm run check` | Type check |
| `npm run db:generate` / `npm run db:migrate` | Database migrations |
| `npm run db:seed` | Sample data for development. Refuses to run over real data without `-- --force` |

## What runs when (the worker)

All times are South African.

| When | Job |
| --- | --- |
| Every 2 hours, 07:00 to 19:00 on weekdays | Fetch new tenders, re-check tenders you're bidding on, then send new-tender and change alerts |
| 02:00 daily | Fetch, and re-check every open relevant tender for addenda and new closing dates |
| 07:00 weekdays | The new-tender digest, if Settings asks for one |
| 07:00 daily | Reminders: compulsory briefings within 48 hours, vault documents expiring before a bid closes, results due |
| 01:30 daily | Backup, keeping the newest 14 |
| Every 5 seconds | "Fetch now" from the app, and downloading the documents of newly started bids |

## Where data lives

Everything is under `data/` (set `DATA_DIR` to move it). It is never committed: it holds ID copies,
tax PINs and company details.

| Path | What |
| --- | --- |
| `data/app.db` | The database (SQLite) |
| `data/vault/` | Vault documents you upload |
| `data/tenders/<ocid>/` | Your uploads for a bid; `docs/` holds the tender's own documents |
| `data/registers/` | Bid registers you keep with a price record |
| `data/outbox/` | Alert emails, written as HTML files (see below) |
| `data/backups/<date>/` | Backups |
| `data/logs/` | App and worker logs, when started at login |

## Alert emails

For now alerts aren't sent: each one is written to `data/outbox/` and logged by the worker. They go
to the address in Settings, or `ALERT_TO` in `.env`. Sending through Gmail SMTP (`SMTP_USER`,
`SMTP_PASS`) is still to come.

## Restoring a backup

1. Stop the app and the worker (Ctrl-C on `npm run dev`, or `npm run autostart -- uninstall`).
2. `npm run restore` lists the backups, newest first.
3. `npm run restore -- 2026-10-22_0130` puts that one back. What was there is moved to
   `data/before-restore-<time>/`, not deleted.
4. Start the app and worker again.

## Starting at login

On macOS:

```sh
npm run build
npm run autostart -- install
```

This adds two launchd agents (`za.itender.app` and `za.itender.worker`) that start at login and
restart if they stop. Run `npm run build` again after updating the code, then
`npm run autostart -- install` to restart them. Elsewhere, pm2 does the same job:
`pm2 start dist/server/entry.mjs --name itender-app && pm2 start worker/index.ts --name itender-worker && pm2 save && pm2 startup`.

## About eTenders data

The OCDS API has some quirks the fetcher works around (details in `src/lib/etenders.ts`):

- A few releases can't be returned, and any page containing one fails. Those pages are read one
  release at a time; the unreadable ones (about 2%) are counted in each fetch run.
- There's no province field. It comes from the buyer's name or a place in the description, and can
  be corrected on the tender.
- Closing times are marked UTC but are South African times, and are read that way.

Whether a tender is relevant is decided by keyword rules (`src/lib/classify.ts`). Claude
classification and reading tender documents are planned (`tender-desk-kit/PLAN.md`, phase 3).
