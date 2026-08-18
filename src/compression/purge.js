'use strict';

// Decodes the simple PURGE compression scheme (WIA only; RVZ removed it):
// a sequence of {offset,size,data} segments, with the rest of the
// decompressed buffer implicitly zero-filled.
function decodePurge(input, outputSize) {
  const out = Buffer.alloc(outputSize);
  let pos = 0;
  // Trailing 20 bytes are a SHA-1 hash of everything preceding it; not needed
  // for extraction, so we only stop once we can't read another full segment
  // header, matching the documented layout ("zero or more wia_segment_t
  // structs ... followed by a SHA-1 hash").
  while (pos + 8 <= input.length - 20) {
    const offset = input.readUInt32BE(pos);
    const size = input.readUInt32BE(pos + 4);
    pos += 8;
    if (size === 0) continue;
    input.copy(out, offset, pos, pos + size);
    pos += size;
  }
  return out;
}

module.exports = { decodePurge };
