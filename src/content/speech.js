// Reads Chinese aloud with the system's built-in voices (Web Speech API; on
// macOS these are the voices from System Settings → Accessibility → Spoken
// Content, e.g. Tingting). Nothing is sent over the network.

const RATE = 0.9;

let voiceLoading = null;

// macOS's novelty "Eloquence" voices exist in every language and sound
// robotic; any natural voice (Tingting, Lili, …) is better.
const NOVELTY = /^(Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley)\b/;

/**
 * Best Mandarin (Mainland) voice, preferring enhanced/premium downloads.
 * Network voices (Chrome lists Google's next to the system ones) are never
 * used, since they send the text to a server.
 */
export function pickVoice(voices) {
  const score = (v) => {
    if (v.localService === false) return -1;
    let s = 0;
    if (/^zh[-_](CN|Hans)/i.test(v.lang)) s += 10;
    else if (/^zh[-_]TW/i.test(v.lang)) s += 4;
    else if (/^zh/i.test(v.lang)) s += 2;
    else return -1;
    if (NOVELTY.test(v.name)) s -= 8;
    if (/premium|enhanced|增强|高品质/i.test(v.name)) s += 3;
    return s;
  };
  const ranked = voices.map((v) => [score(v), v]).filter(([s]) => s >= 0).sort((a, b) => b[0] - a[0]);
  return ranked[0]?.[1] ?? null;
}

let voiceName = null; // the chosen voice's voiceURI, looked up fresh on each play

/**
 * The Mandarin voice to use. Only its identifier is cached: Firefox can
 * rebuild its voice list after the first use, and a stale voice object makes
 * later utterances fail silently.
 */
async function chineseVoice() {
  voiceLoading ??= new Promise((resolve) => {
    if (speechSynthesis.getVoices().length) {
      resolve();
      return;
    }
    // Voices load asynchronously the first time.
    speechSynthesis.addEventListener('voiceschanged', () => resolve(), { once: true });
    setTimeout(resolve, 1500);
  });
  await voiceLoading;
  const voices = speechSynthesis.getVoices();
  const known = voiceName && voices.find((v) => v.voiceURI === voiceName);
  if (known) return known;
  const picked = pickVoice(voices);
  voiceName = picked?.voiceURI ?? null;
  return picked;
}

export const canSpeak = () => typeof speechSynthesis !== 'undefined';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// The utterance being spoken. Keeping a reference stops it from being garbage
// collected mid-speech, which in some engines leaves the queue stuck.
let current = null;

function utter(text, voice) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = voice?.lang ?? 'zh-CN';
  if (voice) utterance.voice = voice;
  utterance.rate = RATE;
  return utterance;
}

/**
 * Speaks `text` in Mandarin, interrupting anything already playing.
 * Resolves with { voice } (null when the system has no Chinese voice, in
 * which case the system default voice is asked to read it as zh-CN).
 */
export async function speak(text) {
  if (!canSpeak() || !text.trim()) return { voice: null };
  const synth = speechSynthesis;
  const voice = await chineseVoice();

  // Firefox applies cancel() asynchronously: speaking straight after it can
  // get the new utterance cancelled too, so only the first play worked.
  // Only cancel when needed, then wait a moment.
  if (synth.speaking || synth.pending || current) {
    synth.cancel();
    current = null;
    await delay(80);
  }
  if (synth.paused) synth.resume();

  const utterance = utter(text, voice);
  current = utterance;
  let started = false;
  utterance.onstart = () => { started = true; };
  utterance.onend = utterance.onerror = () => { if (current === utterance) current = null; };
  synth.speak(utterance);

  // Watchdog: if the engine is wedged and nothing starts, reset it and retry once.
  setTimeout(async () => {
    if (started || current !== utterance) return;
    synth.cancel();
    await delay(80);
    if (current !== utterance) return;
    const retry = utter(text, voice);
    current = retry;
    retry.onend = retry.onerror = () => { if (current === retry) current = null; };
    synth.speak(retry);
  }, 1000);

  return { voice };
}

export function stopSpeaking() {
  if (!canSpeak()) return;
  current = null;
  speechSynthesis.cancel();
}
