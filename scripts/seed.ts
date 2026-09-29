// `npm run seed` — reset the running emulators and load demo data.
import { resetEmulators, seed, USERS, PASSWORD } from './seed-lib.ts';

await resetEmulators();
await seed({ historyCount: 200, demo: true });
console.log('Seeded emulators. Sign in at http://127.0.0.1:5317 with password', PASSWORD);
for (const u of USERS) console.log(`  ${u.role.padEnd(6)} ${u.status.padEnd(11)} ${u.email}`);
