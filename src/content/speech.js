// Reads Chinese aloud with the system's built-in voices (Web Speech API; on
// macOS these are the voices from System Settings → Accessibility → Spoken
// Content, e.g. Tingting). Nothing is sent over the network.

const RATE = 0.9;

let voiceLoading = null;

// macOS's novelty "Eloquence" voices exist in every language and sound
// robotic; any natural voice (Tingting, Lili, …) is better.
const NOVELTY = /^(Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley)\b/;

/** Best Mandarin (Mainland) voice, preferring enhanced/premium downloads. */
export function pickVoice(voices) {
  const score = (v) => {
    let s = 0;
    if (/^zh[-_](CN|Hans)/i.test(v.lang)) s += 10;
    else if (/^zh[-_]TW/i.test(v.lang)) s += 4;
    else if (/^zh/i.test(v.lang)) s += 2;
    else return -1;
    if (NOVELTY.test(v.name)) s -= 8;
    if (/premium|enhanced|增强|高品质/i.test(v.name)) s += 3;
    if (v.localService) s += 1;
    return s;
  };
  const ranked = voices.map((v) => [score(v), v]).filter(([s]) => s >= 0).sort((a, b) => b[0] - a[0]);
  return ranked[0]?.[1] ?? null;
}

function chineseVoice() {
  voiceLoading ??= new Promise((resolve) => {
    const voices = speechSynthesis.getVoices();
    if (voices.length) {
      resolve(pickVoice(voices));
      return;
    }
    // Voices load asynchronously the first time.
    const done = () => resolve(pickVoice(speechSynthesis.getVoices()));
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
  return voiceLoading;
}

export const canSpeak = () => typeof speechSynthesis !== 'undefined';

/**
 * Speaks `text` in Mandarin, interrupting anything already playing.
 * Resolves with { voice } (null when the system has no Chinese voice, in
 * which case the system default voice is asked to read it as zh-CN).
 */
export async function speak(text) {
  if (!canSpeak() || !text.trim()) return { voice: null };
  const voice = await chineseVoice();
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = voice?.lang ?? 'zh-CN';
  if (voice) utterance.voice = voice;
  utterance.rate = RATE;
  speechSynthesis.speak(utterance);
  return { voice };
}

export function stopSpeaking() {
  if (canSpeak()) speechSynthesis.cancel();
}
