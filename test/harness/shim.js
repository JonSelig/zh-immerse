// Stand-in for the WebExtension `browser` API, backed by the harness server.
// Exposes window.zhi for driving the content script from tests or devtools.
(() => {
  const SETTINGS_KEY = 'zhiHarnessSettings';
  const changeListeners = [];
  const messageListeners = [];

  const readSettings = () => {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; }
  };

  window.__zhiDebug = true;

  window.browser = {
    runtime: {
      sendMessage: (msg) => fetch('/api', { method: 'POST', body: JSON.stringify(msg) }).then((r) => r.json()),
      onMessage: { addListener: (fn) => messageListeners.push(fn) },
      getURL: (path) => `/ext/${path}`,
    },
    storage: {
      local: {
        async get(defaults) { return { ...defaults, ...readSettings() }; },
        async set(patch) {
          const before = readSettings();
          localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...before, ...patch }));
          const changes = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, { oldValue: before[k], newValue: v }]));
          changeListeners.forEach((fn) => fn(changes, 'local'));
        },
      },
      onChanged: { addListener: (fn) => changeListeners.push(fn) },
    },
    tabs: {
      query: async () => [{ id: 1 }],
      sendMessage: (_id, msg) => window.zhi.message(msg),
      create: ({ url }) => window.open(url),
    },
    permissions: { contains: async () => true, request: async () => true },
  };

  window.zhi = {
    set: (patch) => browser.storage.local.set(patch),
    reset: () => localStorage.removeItem(SETTINGS_KEY),
    async message(msg) {
      for (const fn of messageListeners) {
        const result = fn(msg);
        if (result !== undefined) return result;
      }
      return undefined;
    },
    togglePage: () => window.zhi.message({ type: 'togglePage' }),
    state: () => window.zhi.message({ type: 'pageState' }),
  };
})();
