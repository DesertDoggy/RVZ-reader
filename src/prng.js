'use strict';

// Lagged Fibonacci generator (f = xor, j = 32, k = 521) used by GC/Wii discs to
// pad unused areas, and losslessly re-encoded by RVZ's "packing" scheme.
// See docs/WiaAndRvz.md ("RVZ packing" section) in dolphin-emu/dolphin for the
// public algorithm description that this is implemented from.
const BUFFER_WORDS = 521;
const LAG = 32;

class JunkPrng {
  constructor(seed) {
    if (seed.length !== 68) {
      throw new Error(`PRNG seed must be 68 bytes, got ${seed.length}`);
    }
    this.buffer = new Uint32Array(BUFFER_WORDS);
    for (let i = 0; i < 17; i++) {
      this.buffer[i] = seed.readUInt32BE(i * 4);
    }
    for (let i = 17; i < BUFFER_WORDS; i++) {
      const a = this.buffer[i - 17];
      const b = this.buffer[i - 16];
      const c = this.buffer[i - 1];
      this.buffer[i] = (((a << 23) >>> 0) ^ (b >>> 9) ^ c) >>> 0;
    }
    this.wordIndex = 0;
  }

  _advance() {
    const buf = this.buffer;
    for (let i = 0; i < LAG; i++) {
      buf[i] = (buf[i] ^ buf[i + BUFFER_WORDS - LAG]) >>> 0;
    }
    for (let i = LAG; i < BUFFER_WORDS; i++) {
      buf[i] = (buf[i] ^ buf[i - LAG]) >>> 0;
    }
  }

  // Skip `count` bytes of generated output without producing them.
  skipBytes(count) {
    let remaining = count;
    while (remaining > 0) {
      if (this.wordIndex === 0) {
        this._advance();
      }
      const take = Math.min(4, remaining);
      remaining -= take;
      this.wordIndex++;
      if (this.wordIndex === BUFFER_WORDS) {
        this.wordIndex = 0;
      }
    }
  }

  // Generate `size` bytes of junk data.
  generate(size) {
    const out = Buffer.alloc(size);
    let outOff = 0;
    while (outOff < size) {
      if (this.wordIndex === 0) {
        this._advance();
      }
      const word = this.buffer[this.wordIndex];
      const b0 = (word >>> 24) & 0xff;
      const b1 = (word >>> 18) & 0xff; // NB: shift by 18, not 16 (per spec).
      const b2 = (word >>> 8) & 0xff;
      const b3 = word & 0xff;
      const bytes = [b0, b1, b2, b3];
      for (let i = 0; i < 4 && outOff < size; i++) {
        out[outOff++] = bytes[i];
      }
      this.wordIndex++;
      if (this.wordIndex === BUFFER_WORDS) {
        this.wordIndex = 0;
      }
    }
    return out;
  }
}

// Creates a PRNG state ready to output data at `discOffset` (must know the
// offset of the very start of the segment being padded so the generator can
// be fast-forwarded to the correct alignment within a 32 KiB sector).
function createPrngAt(seed, discOffset) {
  const prng = new JunkPrng(seed);
  // Must run the initial advance 4 times per spec before any output.
  prng._advance();
  prng._advance();
  prng._advance();
  prng._advance();
  const misalignment = discOffset % 0x8000;
  if (misalignment !== 0) {
    prng.skipBytes(misalignment);
  }
  return prng;
}

module.exports = { JunkPrng, createPrngAt };
