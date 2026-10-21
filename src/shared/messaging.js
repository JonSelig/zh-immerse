// runtime messaging that works the same in Firefox and Chrome.
//
// Firefox lets an onMessage listener reply by returning a promise; Chrome
// before 148 ignores the returned promise and the sender gets undefined. So
// replies go through sendResponse, which both support. A failed handler can't
// reject the sender's promise that way, so its error travels as
// { [ERROR]: message } and sendMessage/sendToTab rethrow it.

const ERROR = '__zhiError';

/**
 * Registers handler(msg, sender) -> reply | Promise<reply> | undefined.
 * undefined means "not for me" (no reply is sent).
 */
export function onMessage(handler) {
  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    let reply;
    try {
      reply = handler(msg, sender);
    } catch (err) {
      reply = Promise.reject(err);
    }
    if (reply === undefined) return false;
    Promise.resolve(reply).then(sendResponse, (err) => sendResponse({ [ERROR]: String(err?.message ?? err) }));
    return true; // keeps the channel open for the async sendResponse
  });
}

function unwrap(reply) {
  if (reply && typeof reply === 'object' && ERROR in reply) throw new Error(reply[ERROR]);
  return reply;
}

export const sendMessage = (msg) => browser.runtime.sendMessage(msg).then(unwrap);
export const sendToTab = (tabId, msg) => browser.tabs.sendMessage(tabId, msg).then(unwrap);
