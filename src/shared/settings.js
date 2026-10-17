// Settings live in browser.storage.local so every tab sees changes immediately.
export const DEFAULT_SETTINGS = {
  enabled: true, // translate pages automatically
  pinyin: false, // show pinyin above characters
  level: 7, // 1–6: swap only HSK 1..level words into Chinese; 7: translate everything
  disabledSites: [], // hostnames left in English
};

export async function loadSettings() {
  return browser.storage.local.get(DEFAULT_SETTINGS);
}
