// Builds search/{messageId} docs for every existing message. Safe to re-run.
//   Emulator:   npx tsx scripts/backfill-search.ts --emulator
//   Production: npx tsx scripts/backfill-search.ts --prod   (uses .secrets/flack-deployer.json)
import { readFileSync, existsSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { buildTerms, snippet } from '../firebase/functions/src/search/terms.ts';

const prod = process.argv.includes('--prod');
const emulator = process.argv.includes('--emulator');
if (prod === emulator) {
  console.error('Pass exactly one of --prod or --emulator');
  process.exit(2);
}

let projectId = 'demo-flack';
if (prod) {
  projectId = /FLACK_PROJECT="([^"]+)"/.exec(readFileSync(new URL('./project.env', import.meta.url), 'utf8'))?.[1] ?? '';
  const key = new URL('../.secrets/flack-deployer.json', import.meta.url);
  if (!projectId || !existsSync(key)) throw new Error('missing FLACK_PROJECT or deployer key');
  initializeApp({ credential: cert(JSON.parse(readFileSync(key, 'utf8'))), projectId });
} else {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8380';
  initializeApp({ projectId });
}
const db = getFirestore();

const names = new Map((await db.collection('users').get()).docs.map((d) => [d.id, d.get('displayName') as string]));
let total = 0;
let skipped = 0;
let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
for (;;) {
  let q = db.collectionGroup('messages').orderBy('__name__').limit(300);
  if (last) q = q.startAfter(last);
  const page = await q.get();
  if (page.empty) break;
  const batch = db.batch();
  for (const d of page.docs) {
    const m = d.data();
    const files: string[] = (m.attachments ?? []).map((a: { name: string }) => a.name);
    if (m.deleted || (!m.text && !files.length)) {
      skipped++;
      continue;
    }
    batch.set(db.doc(`search/${d.id}`), {
      channelId: d.ref.parent.parent!.id,
      messageId: d.id,
      threadParentId: m.threadParentId ?? null,
      authorId: m.authorId,
      createdAt: m.createdAt,
      terms: buildTerms(m.text ?? '', files),
      snippet: snippet(m.text ?? '', names) || (files.length ? `📎 ${files.join(', ')}` : ''),
      hasFile: files.length > 0,
    });
    total++;
  }
  await batch.commit();
  last = page.docs[page.docs.length - 1];
}
console.log(`[${projectId}] indexed ${total} messages (${skipped} deleted/empty skipped)`);
process.exit(0);
