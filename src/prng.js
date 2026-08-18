'use strict';

// Lagged Fibonacci generator (f = xor, j = 32, k = 521) used by GC/Wii discs to
// pad unused areas, and losslessly re-encoded by RVZ's "packing" scheme.
const BUFFER_WORDS = 521;
const LAG = 32;
// The 4 output bytes of each 32-bit word are taken with these bit shifts.
// The second byte uses 18 instead of the "natural" 16, which is a quirk of
// the original algorithm being replicated (bits 16-17 of the word never
// appear in the output, and bits 24-25 appear twice).
const BYTE_SHIFTS = [24, 18, 8, 0];

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
    // Byte cursor into the buffer (0 to BUFFER_WORDS*4-1). Only advances the
    // generator once this reaches the end of the buffer -- never before the
    // first byte is produced.
    this.position = 0;
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

  _nextByte() {
    const wordIndex = this.position >>> 2;
    const byteInWord = this.position & 3;
    const word = this.buffer[wordIndex];
    const byte = (word >>> BYTE_SHIFTS[byteInWord]) & 0xff;
    this.position++;
    if (this.position === BUFFER_WORDS * 4) {
      this._advance();
      this.position = 0;
    }
    return byte;
  }

  // Skip `count` bytes of generated output without producing them.
  skipBytes(count) {
    for (let i = 0; i < count; i++) {
      this._nextByte();
    }
  }

  // Generate `size` bytes of junk data.
  generate(size) {
    const out = Buffer.alloc(size);
    for (let i = 0; i < size; i++) {
      out[i] = this._nextByte();
    }
    return out;
  }
}

// Creates a PRNG state ready to output the junk bytes starting at `discOffset`
// (the byte offset, relative to the start of the disc image or partition, of
// the very first byte this padded run will produce). The seed only encodes
// state up to a 32 KiB sector boundary, so the generator must be advanced by
// `discOffset % 0x8000` bytes before producing real output.
function createPrngAt(seed, discOffset) {
  const prng = new JunkPrng(seed);
  // The generator always runs 4 initial advances before producing output.
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

