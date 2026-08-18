'use strict';

const crypto = require('crypto');
const { sha1 } = require('./util/binary');
const {
  SECTOR_SIZE,
  SECTOR_DATA_SIZE,
  SECTOR_HASH_SIZE,
  SECTORS_PER_SUBGROUP,
  SUBGROUPS_PER_GROUP,
  SECTORS_PER_GROUP,
} = require('./constants');

const H0_COUNT = 31;
const H0_HASHED_SIZE = H0_COUNT * 20; // 0x26C
const H1_OFFSET = 0x280;
const H1_HASHED_SIZE = SECTORS_PER_SUBGROUP * 20; // 0xA0
const H2_OFFSET = 0x340;

// Rebuilds the encrypted+hashed on-disc representation of a run of Wii
// partition-data sectors from the decrypted, hash-stripped payload that RVZ
// stores, applying any recorded hash exceptions, and re-encrypting with the
// partition's title key. This follows the publicly documented Wii disc
// hash-tree layout (H0/H1/H2 arrays packed into a 0x400-byte block per
// 0x8000-byte sector, grouped into 8-sector subgroups and 64-sector groups).
function rebuildSectors(decryptedPayload, sectorCount, titleKey, exceptionsByGroup) {
  if (decryptedPayload.length !== sectorCount * SECTOR_DATA_SIZE) {
    throw new Error('Unexpected decrypted payload size for sector rebuild');
  }

  const hashBlocks = new Array(sectorCount);
  for (let s = 0; s < sectorCount; s++) {
    const sectorData = decryptedPayload.subarray(
      s * SECTOR_DATA_SIZE,
      (s + 1) * SECTOR_DATA_SIZE
    );
    const hashBlock = Buffer.alloc(SECTOR_HASH_SIZE);
    for (let b = 0; b < H0_COUNT; b++) {
      const block = sectorData.subarray(b * 0x400, (b + 1) * 0x400);
      sha1(block).copy(hashBlock, b * 20);
    }
    hashBlocks[s] = hashBlock;
  }

  // H1: hash of each sector's H0 table, shared across the 8 sectors of a subgroup.
  for (let sub = 0; sub * SECTORS_PER_SUBGROUP < sectorCount; sub++) {
    const base = sub * SECTORS_PER_SUBGROUP;
    const count = Math.min(SECTORS_PER_SUBGROUP, sectorCount - base);
    const h1 = Buffer.alloc(H1_HASHED_SIZE);
    for (let i = 0; i < count; i++) {
      const h0 = hashBlocks[base + i].subarray(0, H0_HASHED_SIZE);
      sha1(h0).copy(h1, i * 20);
    }
    for (let i = 0; i < count; i++) {
      h1.copy(hashBlocks[base + i], H1_OFFSET);
    }
  }

  // H2: hash of each subgroup's H1 table, shared across the 64 sectors of a group.
  for (let grp = 0; grp * SECTORS_PER_GROUP < sectorCount; grp++) {
    const groupBase = grp * SECTORS_PER_GROUP;
    const subCount = Math.min(
      SUBGROUPS_PER_GROUP,
      Math.ceil((sectorCount - groupBase) / SECTORS_PER_SUBGROUP)
    );
    const h2 = Buffer.alloc(SUBGROUPS_PER_GROUP * 20);
    for (let sg = 0; sg < subCount; sg++) {
      const sectorIdx = groupBase + sg * SECTORS_PER_SUBGROUP;
      const h1 = hashBlocks[sectorIdx].subarray(H1_OFFSET, H1_OFFSET + H1_HASHED_SIZE);
      sha1(h1).copy(h2, sg * 20);
    }
    const groupSectorCount = Math.min(SECTORS_PER_GROUP, sectorCount - groupBase);
    for (let i = 0; i < groupSectorCount; i++) {
      h2.copy(hashBlocks[groupBase + i], H2_OFFSET);
    }

    // Apply recorded exceptions for this group, if any. Exceptions are given
    // as offsets into the linear (sector-major) hash stream of the group.
    const exceptions = exceptionsByGroup ? exceptionsByGroup[grp] : null;
    if (exceptions) {
      for (const ex of exceptions) {
        const sectorInGroup = Math.floor(ex.offset / SECTOR_HASH_SIZE);
        const offsetInSector = ex.offset % SECTOR_HASH_SIZE;
        const sectorIdx = groupBase + sectorInGroup;
        if (sectorIdx < sectorCount) {
          ex.hash.copy(hashBlocks[sectorIdx], offsetInSector);
        }
      }
    }
  }

  const output = Buffer.alloc(sectorCount * SECTOR_SIZE);
  const zeroIv = Buffer.alloc(16);
  for (let s = 0; s < sectorCount; s++) {
    const hashCipher = crypto
      .createCipheriv('aes-128-cbc', titleKey, zeroIv)
      .setAutoPadding(false);
    const encryptedHash = Buffer.concat([hashCipher.update(hashBlocks[s]), hashCipher.final()]);

    const dataIv = encryptedHash.subarray(0x3d0, 0x3e0);
    const sectorData = decryptedPayload.subarray(
      s * SECTOR_DATA_SIZE,
      (s + 1) * SECTOR_DATA_SIZE
    );
    const dataCipher = crypto
      .createCipheriv('aes-128-cbc', titleKey, dataIv)
      .setAutoPadding(false);
    const encryptedData = Buffer.concat([dataCipher.update(sectorData), dataCipher.final()]);

    encryptedHash.copy(output, s * SECTOR_SIZE);
    encryptedData.copy(output, s * SECTOR_SIZE + SECTOR_HASH_SIZE);
  }

  return output;
}

module.exports = { rebuildSectors };
