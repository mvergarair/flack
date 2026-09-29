// Emulator admin CLI used by the e2e suite (Playwright can't load firebase-admin itself).
//   tsx scripts/emu-cli.ts reset
//   tsx scripts/emu-cli.ts seed '{"historyCount":200}'
//   tsx scripts/emu-cli.ts set 'invites/seedInvite' '{"expiresAt":{"__ts":0}}'
//   tsx scripts/emu-cli.ts get 'users/uMember'
//   tsx scripts/emu-cli.ts run-scheduled '{"backdate":true}'   (fire the 10-minute sweep now)
import { resetEmulators, seed, adminDb, Timestamp } from './seed-lib.ts';

const [cmd, a1, a2] = process.argv.slice(2);
const revive = (_k: string, v: unknown) =>
  v && typeof v === 'object' && '__ts' in (v as object) ? Timestamp.fromMillis((v as { __ts: number }).__ts) : v;

switch (cmd) {
  case 'reset':
    await resetEmulators();
    break;
  case 'seed':
    await resetEmulators();
    await seed(a1 ? JSON.parse(a1) : {});
    break;
  case 'set':
    await (await adminDb()).doc(a1).set(JSON.parse(a2, revive), { merge: true });
    break;
  case 'get': {
    const snap = await (await adminDb()).doc(a1).get();
    process.stdout.write(JSON.stringify(snap.exists ? snap.data() : null));
    break;
  }
  case 'query': {
    const snap = await (await adminDb()).collection(a1).get();
    process.stdout.write(JSON.stringify(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    break;
  }
  case 'run-scheduled': {
    // "Fast-forward": optionally make every pending item due, then run the scheduled function.
    const db = await adminDb();
    const { backdate = false } = a1 ? (JSON.parse(a1) as { backdate?: boolean }) : {};
    const pending = () => db.collectionGroup('scheduled').where('status', '==', 'pending').get();
    if (backdate) {
      for (const d of (await pending()).docs) await d.ref.update({ sendAt: Timestamp.fromMillis(Date.now() - 60_000) });
    }
    // v2 scheduled functions are HTTP functions (Cloud Scheduler calls them); the emulator
    // exposes them on its internal trigger path. The call returns once the run has finished.
    const res = await fetch('http://127.0.0.1:5301/functions/projects/demo-flack/triggers/us-central1-sendscheduled-0', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) throw new Error(`sendscheduled failed: ${res.status} ${await res.text()}`);
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const due = (await pending()).docs.filter((d) => (d.get('sendAt') as Timestamp).toMillis() <= Date.now() + 60_000);
      if (!due.length) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    await new Promise((r) => setTimeout(r, 500)); // pushes/activity written right after
    break;
  }
  default:
    console.error('unknown command', cmd);
    process.exit(2);
}
process.exit(0);
