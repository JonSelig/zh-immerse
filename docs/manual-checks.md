# Manual checks

Things the automated tests can't cover. Run them in a real browser after a
change that touches the area, and before a release.

Setup: `npm run build`, `npm run install:host` (once), then load the extension:

- **Firefox:** `npm start` (temporary profile), or *about:debugging → This
  Firefox → Load Temporary Add-on…* → `extension/manifest.json`.
- **Chrome:** *chrome://extensions* → Developer mode → *Load unpacked* →
  `build/chrome/`. The ID must be `foakbnkggnfiboimjoffkjdnopkcicfe`.

After a rebuild, reload the extension (and the tabs you test in).

## Both browsers

- [ ] **Translation:** an English article (e.g. Wikipedia) turns Chinese;
      the toolbar popup shows "● Translator ready".
- [ ] **Hover popup:** pinyin and meanings show; the popup is styled on a
      site with a strict CSP (e.g. github.com).
- [ ] **Graded level (2):** a few words are swapped and underlined; hovering
      one shows *replaces "…"*; "I live in China" shows 住在.
- [ ] **🔊:** the word and sentence play in Tingting (or your Enhanced
      voice), never a "Google 普通话" voice. Selecting Chinese text shows a 🔊
      button.
- [ ] **Shortcuts:** ⌥⇧Z (show English) and ⌥⇧P (pinyin) work.
- [ ] **Word list:** looked-up words appear; *Backup → Clear translation
      cache…* works.
- [ ] **My words:** popup → 我的 → *Edit my words*; importing an Anki
      `.apkg` lists its words; an English page at 我的 swaps only those.
- [ ] **Not installed:** with the helper unregistered, the popup says
      "The translation helper isn't installed".

## Firefox only

- [ ] **Profile upgrade:** with an existing profile from before database
      version 2, the word history and cache survive (take a JSON backup from
      the word list first).

## Chrome only

- [ ] **Chrome 148+:** everything above still works (Chrome then has its
      own `browser` namespace).
