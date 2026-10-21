# Manual checks

Things the automated tests can't cover. Run them in a real browser after a
change that touches the area, and before a release.

Setup: `npm run build`, `npm run install:host` (once), then load the extension:

- **Firefox:** `npm start` (temporary profile), or *about:debugging → This
  Firefox → Load Temporary Add-on…* → `extension/manifest.json`.
- **Chrome:** *chrome://extensions* → Developer mode → *Load unpacked* →
  `build/chrome/`. The ID must be `foakbnkggnfiboimjoffkjdnopkcicfe`, the one
  `npm run install:host` registers.

After a rebuild, reload the extension (and the tabs you test in).

## Both browsers

- [ ] **Translation:** an English article (e.g. Wikipedia) turns Chinese;
      the toolbar popup shows "● Translator ready".
- [ ] **Hover popup:** pinyin and meanings show; the popup is styled on a
      site with a strict CSP (e.g. github.com).
- [ ] **Graded level (2):** a few words are swapped and underlined; hovering
      one shows *replaces "…"*. On a page with the sentence "I live in
      China." (e.g. a local HTML file), it shows "I 住在 China.".
- [ ] **🔊 voice:** the word and sentence play in Tingting (or your Enhanced
      voice), never a "Google 普通话" voice.
- [ ] **🔊 selection:** selecting Chinese text shows a 🔊 button that plays it.
- [ ] **Shortcuts:** ⌥⇧Z (show English) and ⌥⇧P (pinyin) work.
- [ ] **Word list:** looked-up words appear; *Backup → Clear translation
      cache…* works.
- [ ] **My words:** popup → 我的 → *Edit my words*; importing an Anki
      `.apkg` lists its words; an English page at 我的 swaps only those.
- [ ] **My words, empty:** at 我的 with no words, pages stay English; adding
      a word updates an open page without a reload.
- [ ] **My words, two tabs:** a word added in one My words tab appears in
      another.
- [ ] **Icons:** the toolbar icon (16/32 px) looks crisp in light and dark
      toolbars.
- [ ] **Not installed:** with the helper unregistered, the popup says
      "The translation helper isn't installed".

## Firefox only

- [ ] **Profile upgrade:** with an existing profile from before database
      version 2, the word history and cache survive (take a JSON backup from
      the word list first).

## Chrome only

- [ ] **Chrome 148+:** everything above still works (Chrome then has its
      own `browser` namespace).
