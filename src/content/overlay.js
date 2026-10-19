// UI drawn over the page (hover popup, play button) lives in a closed shadow
// root: page scripts can't read it (the popup shows the user's lookup history)
// and page CSS can't restyle it. The host is a plain <div>, not a custom
// element, so a page can't define a class for it and intercept attachShadow.

import STYLES from './overlay.css';
import { OWN_ATTR } from './translate.js';

/** Returns { host, root }; append UI to `root`. */
export function createOverlay() {
  const host = document.createElement('div');
  host.setAttribute(OWN_ATTR, '');
  // Inline !important beats any page stylesheet rule that matches the host.
  host.style.setProperty('all', 'initial', 'important');
  host.style.setProperty('position', 'fixed', 'important');
  host.style.setProperty('top', '0', 'important');
  host.style.setProperty('left', '0', 'important');
  host.style.setProperty('z-index', '2147483647', 'important');
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = STYLES;
  root.append(style);
  // Outside <body>, so the page translator's MutationObserver never sees it.
  document.documentElement.append(host);
  return { host, root };
}
