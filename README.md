# zh-immerse

A Firefox and Chrome extension for reading the web in Simplified Chinese. English pages are
translated **on your Mac** with Apple's built-in Translation framework, and
reading aids are there when a sentence is too hard:

- **Hover a word** for its pinyin (tone-colored), meanings (CC-CEDICT) and the
  original English of the sentence.
- **Pinyin above characters**: toggle with ⌥⇧P or from the toolbar popup.
- **Listen**: 🔊 in the popup plays the word (or press **P**); *🔊 Sentence*
  plays the whole sentence (**Shift+P**). Select any Chinese text to get a 🔊
  button for that phrase. This uses the Mac's built-in voices (Tingting by
  default; download Enhanced/Premium voices in System Settings → Accessibility →
  Spoken Content → System Voice → Manage Voices for better quality).
- **Lookup history**: every word you rest on for more than 0.6 s is counted,
  with the sentences you met it in. Press **S** in the popup to save a word.
- **Word list** (toolbar popup → *Open word list*): sort by most looked up,
  filter by count or date, and export to Anki (TSV) or a JSON backup.
  *Backup → Clear translation cache* deletes the saved translations.
- **Levels** (toolbar popup): 1–6 swap only words from HSK 3.0 levels 1 up to
  that level into Chinese and leave the rest in English ("The 天气 is nice
  今天, so we are 去 for a walk in the 公园."); **全部** translates everything.
  Swapped words have a dotted underline, and hovering one shows the
  original sentence. A word is swapped only if its Chinese also appears in
  Apple's translation of the whole sentence, so "like" becomes 喜欢 in "I like
  apples" but stays English in "it looks like rain".
- **⌥⇧Z** switches the current tab between Chinese and the original English.

Nothing leaves your machine: translation is on-device, and the dictionary and
your history are stored locally in the extension. Translations are cached so
pages you revisit load quickly; the cache is kept separately for each site
(so one site can't tell what you read on another) and holds the newest 50,000
passages.
Saved example sentences keep the page's address without its query string.
In private windows (if you allow the extension there) nothing is cached or
counted.

## How it works

```
content script ──> background script ──native messaging──> zh-translate-host (Swift)
DOM text swap,      cache, batching,                        Apple TranslationSession
hover, pinyin       dictionary, history                     en → zh-Hans
```

Browsers don't give extensions Apple's translator, so a small native helper
(`native-host/`) does the translating; the browser starts it on demand. In
Chrome the background script runs as a service worker, which the open
connection to the helper keeps alive while pages are being translated.

Text nodes are edited in place rather than replaced, so pages built with
React and similar frameworks keep working. A sentence containing links or
formatting is translated as a whole: the helper wraps each piece in a numbered
tag (`<a0>Read the </a0><a1>docs</a1>…`), which Apple's translator keeps around
the matching Chinese words, and the result is split back into the pieces.

## Setup

Requirements: macOS 26.4+, Firefox 140+ or Chrome 141+, Node.js, and Xcode or
the Command Line Tools with a macOS 26.4+ SDK.

1. **Download the translation languages.** System Settings → General →
   Language & Region → Translation Languages: download **Chinese (Simplified)**
   and **English**.
2. **Build:**
   ```sh
   npm install
   curl -L -o data-src/cedict.txt.gz --create-dirs \
     https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz
   npm run build:dict
   for i in 1 2 3 4 5 6; do curl -L -o data-src/hsk3/$i.min.json --create-dirs \
     https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/wordlists/exclusive/new/$i.min.json; done
   npm run build:hsk
   npm run build
   ```
   `npm run build` writes the Firefox extension to `extension/` and the Chrome
   one to `build/chrome/`.
3. **Install the native helper.** It's copied to
   `~/Library/Application Support/zh-immerse/` and registered for Firefox and
   Google Chrome (`…/Mozilla/NativeMessagingHosts/` and
   `…/Google/Chrome/NativeMessagingHosts/`), and for Chrome Beta/Canary,
   Chromium, Brave, Edge and Arc if they're installed:
   ```sh
   npm run install:host
   npm run test:host     # should print Chinese translations
   ```
4. **Run it in Firefox:**
   - **Try it:** `npm start` opens a temporary Firefox profile with the
     extension loaded.
   - **Install permanently:** release Firefox only installs signed extensions.
     Create API credentials at <https://addons.mozilla.org/developers/addon/api/key/>.
     The page labels them **JWT issuer** (the key, e.g. `user:12345678:123`) and
     **JWT secret**. Then run:
     ```sh
     WEB_EXT_API_KEY=… WEB_EXT_API_SECRET=… npm run sign
     ```
     This bumps the patch version in `extension/manifest.json` (each version
     can be signed only once; use `npm run bump minor` for bigger releases),
     then signs the extension as *unlisted*, so it isn't published. Open the
     `.xpi` it writes to `web-ext-artifacts/` in Firefox. Alternatively, use
     Firefox Developer Edition with `xpinstall.signatures.required` set to
     `false` in `about:config`.
   - **Grant site access:** on first use, open the toolbar popup and allow
     access to all websites if Firefox asks.
5. **Run it in Chrome:** open `chrome://extensions`, turn on **Developer
   mode**, click **Load unpacked** and choose `build/chrome/`. It stays
   installed across restarts. After rebuilding, click the extension's reload
   button there. The extension ID is fixed
   (`foakbnkggnfiboimjoffkjdnopkcicfe`, from the `key` in
   `scripts/build.mjs`), which is what the helper's registration allows.
   Pages that were open before installing need a reload. Word history is
   stored per browser; to move it, use *Backup → Export backup* in one
   browser's word list and *Import backup* in the other.

## Development

| Command | What it does |
| --- | --- |
| `npm run watch` | Rebuild `extension/dist/` and `build/chrome/` on change (edits to `extension/` HTML/CSS reach `build/chrome/` on the next rebuild) |
| `npm test` | Unit tests for the shared logic (pinyin, history, export) |
| `npm run test:host` | Smoke test of the native helper over the real protocol |
| `npm run lint` | `web-ext lint` (Firefox) |
| `npm run harness` | Serves `test/fixtures/` at <http://localhost:8787> with the real content script and a stand-in extension API, for testing page behaviour in any browser. Uses Apple Translation when the language pack is installed, otherwise a stand-in translator. |

Layout:

- `native-host/`: Swift native-messaging host, plus build and install scripts
- `src/background/`: native connection, translation queue and cache (IndexedDB), dictionary, word history
- `src/content/`: page translator, hover popup, pinyin ruby
- `src/shared/`: pure logic shared with tests (pinyin, text, dictionary, graded levels, history/export)
- `src/popup/`, `src/vocab/`: toolbar popup and word-list page
- `extension/`: Firefox manifest, static HTML/CSS, icons, generated `dist/` and `data/`
- `build/chrome/`: generated Chrome build (`extension/` plus a Chrome manifest made by `scripts/build.mjs`)

## Credits

Dictionary: [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict),
CC BY-SA 4.0. HSK 3.0 word lists:
[complete-hsk-vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary) (MIT). Pinyin for the pinyin mode: [pinyin-pro](https://github.com/zh-lx/pinyin-pro) (MIT).

## License

The code is under the [MIT License](LICENSE). The dictionary and word-list
data the build downloads keep their own licenses: CC-CEDICT is CC BY-SA 4.0
and complete-hsk-vocabulary is MIT. Their notices ship with the extension in
`extension/data/`.
