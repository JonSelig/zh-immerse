// Client for the native host's framed stdio protocol (the same one Firefox
// uses). Shared by the smoke test, the test harness and build-hsk.mjs.

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_HOST = resolve(dirname(fileURLToPath(import.meta.url)), '../native-host/build/zh-translate-host');

export function startHost(path = DEFAULT_HOST) {
  const child = spawn(path, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map();
  let buffer = Buffer.alloc(0);
  let nextId = 1;
  child.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const len = buffer.readUInt32LE(0);
      if (buffer.length < 4 + len) break;
      const msg = JSON.parse(buffer.subarray(4, 4 + len).toString('utf8'));
      buffer = buffer.subarray(4 + len);
      pending.get(msg.id)?.(msg);
      pending.delete(msg.id);
    }
  });
  return {
    send(payload) {
      const id = nextId++;
      const body = Buffer.from(JSON.stringify({ id, ...payload }));
      const header = Buffer.alloc(4);
      header.writeUInt32LE(body.length);
      child.stdin.write(Buffer.concat([header, body]));
      return new Promise((res) => pending.set(id, res));
    },
    close() { child.stdin.end(); },
  };
}

