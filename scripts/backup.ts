// `npm run backup`: copy the database and uploaded files into data/backups/<date>/.
import { backup } from '../src/lib/backup.ts';

console.log(await backup());
process.exit(0);
