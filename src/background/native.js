// Connection to the Swift native-messaging host (see native-host/).

const HOST = 'zh_immerse';
const TIMEOUT_MS = 60_000;

let port = null;
let nextId = 1;
const pending = new Map(); // id -> { resolve, reject, timer }

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

function settle(id, fn) {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  clearTimeout(p.timer);
  fn(p);
}

function connect() {
  const p = browser.runtime.connectNative(HOST);
  p.onMessage.addListener((msg) => {
    settle(msg.id, ({ resolve, reject }) => {
      if (msg.error) reject(fail(msg.code ?? 'internal', msg.error));
      else resolve(msg);
    });
  });
  p.onDisconnect.addListener((dead) => {
    // Firefox reports "No such native application zh_immerse" when the host
    // manifest is missing, and an exit message when the process dies.
    const message = dead.error?.message ?? 'native host disconnected';
    const code = /no such native application/i.test(message) ? 'hostMissing' : 'hostDisconnected';
    for (const id of [...pending.keys()]) settle(id, ({ reject }) => reject(fail(code, message)));
    if (port === dead) port = null;
  });
  return p;
}

/** Sends one request to the host and resolves with its reply. */
export function request(payload) {
  port ??= connect();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      settle(id, ({ reject: rej }) => rej(fail('timeout', 'native host did not answer in time')));
    }, TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    try {
      port.postMessage({ id, ...payload });
    } catch (err) {
      port = null;
      settle(id, ({ reject: rej }) => rej(fail('hostMissing', err.message)));
    }
  });
}

/** -> { status: 'installed' | 'supported' | 'unsupported' } or { error, code } */
export async function hostStatus() {
  try {
    const { status } = await request({ type: 'status' });
    return { status };
  } catch (err) {
    return { error: err.message, code: err.code };
  }
}
