'use strict';

const { createPrngAt } = require('./prng');

// Decodes the RVZ "packing" scheme: a stream of
// [u32 size (msb = is-junk)] [either `size` literal bytes, or 68 bytes of PRNG
// seed used to regenerate `size` bytes of junk], relative to `baseDiscOffset`
// (needed so the PRNG can be aligned to the correct 32 KiB sector boundary).
function decodeRvzPacking(input, outputSize, baseDiscOffset) {
  const output = Buffer.alloc(outputSize);
  let inPos = 0;
  let outPos = 0;
  while (outPos < outputSize) {
    const header = input.readUInt32BE(inPos);
    inPos += 4;
    const isJunk = (header & 0x80000000) !== 0;
    const size = header & 0x7fffffff;
    if (!isJunk) {
      input.copy(output, outPos, inPos, inPos + size);
      inPos += size;
    } else {
      const seed = input.subarray(inPos, inPos + 68);
      inPos += 68;
      const prng = createPrngAt(seed, baseDiscOffset + outPos);
      prng.generate(size).copy(output, outPos);
    }
    outPos += size;
  }
  return output;
}

module.exports = { decodeRvzPacking };
