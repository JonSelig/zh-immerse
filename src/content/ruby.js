// Builds <ruby> markup with tone-colored pinyin for a run of Chinese text.

import { pinyin } from 'pinyin-pro';

export const RUBY_CLASS = 'zhi-ruby';

/**
 * Returns <span class="zhi-ruby"> containing one <ruby> per Chinese character
 * and plain text for everything else. pinyin-pro reads the whole string at
 * once, so characters with several readings get the one that fits the context.
 */
export function makeRuby(text) {
  const span = document.createElement('span');
  span.className = RUBY_CLASS;
  let plainRun = '';
  const flush = () => {
    if (plainRun) span.append(plainRun);
    plainRun = '';
  };
  for (const item of pinyin(text, { type: 'all', toneType: 'symbol' })) {
    if (!item.isZh) {
      plainRun += item.origin;
      continue;
    }
    flush();
    const ruby = document.createElement('ruby');
    const rt = document.createElement('rt');
    rt.className = `zhi-t${item.num || 5}`;
    rt.textContent = item.pinyin;
    ruby.append(item.origin, rt);
    span.append(ruby);
  }
  flush();
  return span;
}
