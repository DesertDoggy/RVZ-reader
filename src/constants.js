'use strict';

// Values of wia_disc_t.compression / RVZ compression field.
const CompressionType = Object.freeze({
  NONE: 0,
  PURGE: 1,
  BZIP2: 2,
  LZMA: 3,
  LZMA2: 4,
  ZSTD: 5,
});

const DiscType = Object.freeze({
  UNKNOWN: 0,
  GC: 1,
  WII: 2,
});

const SECTOR_SIZE = 0x8000; // Full encrypted/hashed sector size on a real Wii disc.
const SECTOR_DATA_SIZE = 0x7c00; // Sector payload size once hashes are stripped.
const SECTOR_HASH_SIZE = 0x400; // Sector hash-block size.
const SECTORS_PER_SUBGROUP = 8;
const SUBGROUPS_PER_GROUP = 8;
const SECTORS_PER_GROUP = SECTORS_PER_SUBGROUP * SUBGROUPS_PER_GROUP; // 64 sectors = 2 MiB.
const GROUP_SIZE_ON_DISC = SECTORS_PER_GROUP * SECTOR_SIZE; // 0x200000

const WIA_MAGIC = 'WIA\x01';
const RVZ_MAGIC = 'RVZ\x01';

module.exports = {
  CompressionType,
  DiscType,
  SECTOR_SIZE,
  SECTOR_DATA_SIZE,
  SECTOR_HASH_SIZE,
  SECTORS_PER_SUBGROUP,
  SUBGROUPS_PER_GROUP,
  SECTORS_PER_GROUP,
  GROUP_SIZE_ON_DISC,
  WIA_MAGIC,
  RVZ_MAGIC,
};
