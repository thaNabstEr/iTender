// One fetch run from the command line: `npm run fetch:once`, or `npm run fetch:once -- --recheck`
// to also re-read every open relevant tender. Prints what was added, updated and skipped.
import { runFetch } from '../worker/jobs/fetch.ts';

const verbose = process.argv.includes('--verbose');
const s = await runFetch((m) => console.log(m), { recheckAll: process.argv.includes('--recheck'), quiet: !verbose });
console.log(`\nAdded ${s.added} relevant, updated ${s.updated}, skipped ${s.skipped}, of ${s.fetched} fetched.`);
for (const e of s.errors) console.log(`  ${e}`);
process.exit(0);
