// Shows a small play button next to selected Chinese text, so any phrase can
// be read aloud, not just dictionary words.

import { isCJK } from '../shared/text.js';
import { speak, canSpeak } from './speech.js';
import { createOverlay } from './overlay.js';

const MAX_CHARS = 500;

/** Selected text without pinyin from ruby annotations. */
function selectedChinese(selection) {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return '';
  const fragment = selection.getRangeAt(0).cloneContents();
  fragment.querySelectorAll('rt, rp').forEach((n) => n.remove());
  const text = fragment.textContent.trim();
  return [...text].some(isCJK) ? text.slice(0, MAX_CHARS) : '';
}

export class SelectionSpeaker {
  constructor() {
    this.enabled = false;
    this.onUp = (e) => { if (e.isTrusted) setTimeout(() => this.update(), 0); };
    this.onChange = () => { if (document.getSelection()?.isCollapsed) this.hide(); };
    this.onScroll = () => this.hide();
  }

  enable() {
    if (this.enabled || !canSpeak()) return;
    this.enabled = true;
    document.addEventListener('mouseup', this.onUp, true);
    document.addEventListener('keyup', this.onUp, true);
    document.addEventListener('selectionchange', this.onChange);
    window.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    document.removeEventListener('mouseup', this.onUp, true);
    document.removeEventListener('keyup', this.onUp, true);
    document.removeEventListener('selectionchange', this.onChange);
    window.removeEventListener('scroll', this.onScroll, true);
    this.hide();
  }

  ensureButton() {
    if (this.overlay?.host.isConnected) return;
    this.overlay = createOverlay();
    const button = document.createElement('div');
    button.className = 'zhi-say';
    button.title = 'Read selection aloud';
    button.textContent = '🔊';
    button.hidden = true;
    // Keep the selection when the button is pressed.
    button.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.isTrusted && this.text) speak(this.text);
    });
    this.overlay.root.append(button);
    this.button = button;
  }

  update() {
    const selection = document.getSelection();
    const text = selectedChinese(selection);
    if (!text) {
      this.hide();
      return;
    }
    this.text = text;
    this.ensureButton();
    const rects = selection.getRangeAt(0).getClientRects();
    const last = rects[rects.length - 1];
    if (!last) return;
    const button = this.button;
    button.hidden = false;
    button.style.left = `${Math.round(Math.min(last.right + 4, innerWidth - 36))}px`;
    button.style.top = `${Math.round(Math.max(4, last.top + last.height / 2 - 14))}px`;
  }

  hide() {
    this.text = '';
    if (this.button) this.button.hidden = true;
  }
}
