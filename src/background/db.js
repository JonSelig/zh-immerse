// Minimal promise wrapper over the extension's IndexedDB.
//   translations: { key, value, ts }   key = site + "\n" + source text (or JSON of segments),
//                 index "ts" (write time, for dropping the oldest rows)
//   words:        lookup-history records (see shared/history.js), key = word

const DB_NAME = 'zh-immerse';
const DB_VERSION = 2;

let opening = null;

function open() {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = ({ oldVersion }) => {
      const db = req.result;
      if (oldVersion < 1) {
        db.createObjectStore('translations', { keyPath: 'key' });
        db.createObjectStore('words', { keyPath: 'word' });
      }
      if (oldVersion < 2) req.transaction.objectStore('translations').createIndex('ts', 'ts');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { opening = null; reject(req.error); };
  });
  return opening;
}

const done = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const committed = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

export async function get(store, key) {
  const db = await open();
  return done(db.transaction(store).objectStore(store).get(key));
}

export async function getMany(store, keys) {
  const db = await open();
  const os = db.transaction(store).objectStore(store);
  return Promise.all(keys.map((key) => done(os.get(key))));
}

export async function getAll(store) {
  const db = await open();
  return done(db.transaction(store).objectStore(store).getAll());
}

export async function putMany(store, values) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const value of values) os.put(value);
  return committed(tx);
}

export const put = (store, value) => putMany(store, [value]);

export async function remove(store, key) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  return committed(tx);
}

export async function count(store) {
  const db = await open();
  return done(db.transaction(store).objectStore(store).count());
}

export async function clear(store) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  return committed(tx);
}

/** Deletes the oldest rows (by the "ts" index) beyond `max`; resolves with how many. */
export async function pruneOldest(store, max) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  const excess = (await done(os.count())) - max;
  let removed = 0;
  if (excess > 0) {
    const cursor = os.index('ts').openKeyCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c || removed >= excess) return;
      os.delete(c.primaryKey);
      removed++;
      c.continue();
    };
  }
  await committed(tx);
  return removed;
}
