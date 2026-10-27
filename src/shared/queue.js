// Order in which waiting translations go to the native host: text on screen
// first, then text the page asked for ahead of scrolling. Each lane keeps the
// order keys arrived in. While any tab keeps sending on-screen text, look-ahead
// text waits; it only loses its head start, since it's promoted once it
// scrolls into view.

export class Lanes {
  constructor() {
    this.urgent = new Set(); // on screen
    this.ahead = new Set(); // near the screen
  }

  get size() {
    return this.urgent.size + this.ahead.size;
  }

  /** Queues a key; an on-screen request for a key waiting ahead promotes it. */
  add(key, urgent) {
    if (this.urgent.has(key)) return;
    if (urgent) {
      this.ahead.delete(key);
      this.urgent.add(key);
    } else {
      this.ahead.add(key);
    }
  }

  /** True while `key` is waiting (not yet taken for sending). */
  has(key) {
    return this.urgent.has(key) || this.ahead.has(key);
  }

  /** Drops a waiting key; false if it isn't waiting (e.g. already in flight). */
  remove(key) {
    return this.urgent.delete(key) || this.ahead.delete(key);
  }

  /** Moves a key waiting ahead to the back of the on-screen lane. */
  promote(key) {
    if (!this.ahead.delete(key)) return false;
    this.urgent.add(key);
    return true;
  }

  /**
   * Removes and returns the next batch: up to maxItems keys and maxChars
   * (by sizeOf), but at least one key. Only from the on-screen lane while it
   * has keys, so look-ahead text never delays text on screen.
   */
  take(maxItems, maxChars, sizeOf) {
    const lane = this.urgent.size ? this.urgent : this.ahead;
    const batch = [];
    let chars = 0;
    for (const key of lane) {
      const size = sizeOf(key);
      if (batch.length === maxItems || (batch.length && chars + size > maxChars)) break;
      batch.push(key);
      chars += size;
    }
    for (const key of batch) lane.delete(key);
    return batch;
  }
}
