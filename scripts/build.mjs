// Bundles src/ into extension/dist/ with esbuild, then assembles the Chrome
// build in build/chrome/: a copy of extension/ with a manifest generated from
// the Firefox one (extension/manifest.json stays Firefox-only).
//   node scripts/build.mjs [--watch]
import * as esbuild from 'esbuild';
import { cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';

// Public half of the key that fixes the Chrome extension ID, so the native
// host registration (native-host/install.sh) can name it. It gives the ID
// foakbnkggnfiboimjoffkjdnopkcicfe. The private half isn't needed to load
// the extension unpacked. A Chrome Web Store upload must leave `key` out (the
// store assigns its own ID).
const CHROME_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2Vz3UCA4yy3W0bXGNWER+ql2Wepj++BuXZLmvVkUUY1C8Pb7vjXdfQ045ZNWas2Uf/QQ4q/sn/GLGAQY1sM5JdWIE2AFcZnwkF74DegQ9WdAyqJlw/sqoGlAo8MPGGvhMB0ydlJJD31mU67a5uzEkYj9D8HyH603pvUQUEW6YWsBGLLZOD0ePl5sRdPv712DqMNeMS/14oGcJsbO/AsZFxa2jIqq1U/fqKkvOtpIxVQspl3UhMF+gsu5fXWPTWi0RJKNZ9j2O9KH624JgtLdNidb70LlJ92RpH40jUkge30sec4bX12R+454sSdkYm1LK819ypfy8d96D7AQo86FFQIDAQAB';
const MIN_CHROME = '141';
const CHROME_DIR = 'build/chrome';

const icons = { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' };

function chromeManifest(firefox) {
  const manifest = structuredClone(firefox);
  delete manifest.browser_specific_settings;
  manifest.background = { service_worker: 'dist/background.js' };
  manifest.icons = icons; // Chrome doesn't accept SVG icons
  manifest.action.default_icon = icons;
  manifest.key = CHROME_KEY;
  manifest.minimum_chrome_version = MIN_CHROME;
  return manifest;
}

function assembleChrome() {
  rmSync(CHROME_DIR, { recursive: true, force: true });
  cpSync('extension', CHROME_DIR, { recursive: true, filter: (src) => !src.endsWith('manifest.json') });
  const firefox = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  writeFileSync(`${CHROME_DIR}/manifest.json`, JSON.stringify(chromeManifest(firefox), null, 2) + '\n');
}

const options = {
  entryPoints: {
    background: 'src/background/index.js',
    content: 'src/content/index.js',
    popup: 'src/popup/popup.js',
    vocab: 'src/vocab/vocab.js',
    mywords: 'src/mywords/mywords.js',
  },
  outdir: 'extension/dist',
  loader: { '.css': 'text' }, // src/content/overlay.css is bundled as a string
  // Chrome 148+ and Firefox have `browser`; older Chrome only `chrome`.
  banner: { js: 'globalThis.browser ??= globalThis.chrome;' },
  bundle: true,
  format: 'iife',
  target: ['firefox140', `chrome${MIN_CHROME}`],
  legalComments: 'none',
  logLevel: 'info',
  plugins: [{
    name: 'chrome',
    setup(build) {
      // After every successful build, including in --watch mode. Edits to
      // extension/ itself (HTML, CSS) reach build/chrome/ on the next rebuild.
      build.onEnd((result) => {
        if (!result.errors.length) assembleChrome();
      });
    },
  }],
};

if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
