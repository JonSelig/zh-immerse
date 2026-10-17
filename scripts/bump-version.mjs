// Increments the patch version (0.1.0 -> 0.1.1) in extension/manifest.json and
// package.json. Runs before `npm run sign`, since addons.mozilla.org accepts
// each version number only once.
//   node scripts/bump-version.mjs [major|minor|patch]

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const part = process.argv[2] ?? 'patch';

const files = ['extension/manifest.json', 'package.json'].map((f) => resolve(root, f));
const manifest = JSON.parse(readFileSync(files[0], 'utf8'));
let [major, minor, patch] = manifest.version.split('.').map(Number);

if (part === 'major') [major, minor, patch] = [major + 1, 0, 0];
else if (part === 'minor') [minor, patch] = [minor + 1, 0];
else patch += 1;
const version = `${major}.${minor}.${patch}`;

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  // Edit only the top-level "version" field so the rest of the file's formatting is untouched.
  writeFileSync(file, text.replace(/^(\s*"version":\s*")[^"]+(")/m, `$1${version}$2`));
}
console.log(`version ${manifest.version} -> ${version}`);
