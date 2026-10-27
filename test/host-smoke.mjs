// Talks to the native host over the same framed stdio protocol Firefox uses.
//   node test/host-smoke.mjs [path/to/zh-translate-host]

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startHost } from '../scripts/host-client.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.argv[2] ?? resolve(root, 'native-host/build/zh-translate-host');

async function main() {
  const host = startHost(binary);
  const { status } = await host.send({ type: 'status' });
  console.log('status:', status);

  const texts = [
    'The weather is nice today, so I am going for a walk in the park.',
    'Click here to subscribe to our newsletter.',
    '   ',
    ['Read the ', 'documentation', ' before you install the package.'],
    'Sign in',
  ];
  const started = Date.now();
  const reply = await host.send({ type: 'translate', texts });
  const ms = Date.now() - started;

  if (status !== 'installed') {
    assert.equal(reply.code, 'notInstalled', `expected notInstalled error, got ${JSON.stringify(reply)}`);
    console.log('notInstalled error path OK:', reply.error);
    console.log('\nInstall Chinese (Simplified) in System Settings > General > Language & Region > Translation Languages, then re-run.');
    host.close();
    return;
  }

  assert.ok(Array.isArray(reply.translations), JSON.stringify(reply));
  assert.equal(reply.translations.length, texts.length);
  assert.equal(reply.translations[2], '   ', 'blank text passes through');
  assert.ok(Array.isArray(reply.translations[3]) && reply.translations[3].length === 3, 'segments keep their shape');
  reply.translations.forEach((t, i) => console.log(JSON.stringify(texts[i]), '->', JSON.stringify(t)));
  assert.match(String(reply.translations[0]), /[一-鿿]/, 'output is Chinese');
  console.log(`batch of ${texts.length} in ${ms} ms`);

  const again = Date.now();
  await host.send({ type: 'translate', texts: ['This is a second request on a warm session.'] });
  console.log(`warm single request: ${Date.now() - again} ms`);

  // Both qualities: "fast" (low latency, the default) and "best" (high fidelity).
  for (const quality of ['fast', 'best']) {
    const t = Date.now();
    const r = await host.send({ type: 'translate', quality, texts: [['Please read the ', 'installation guide', ` before you start (${quality}).`]] });
    const segs = r.translations?.[0];
    assert.ok(Array.isArray(segs) && segs.length === 3 && /[一-鿿]/.test(segs[1]), `${quality}: ${JSON.stringify(r)}`);
    console.log(`${quality}: ${JSON.stringify(segs)} in ${Date.now() - t} ms`);
  }
  host.close();
  console.log('OK');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
