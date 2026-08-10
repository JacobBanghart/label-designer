/**
 * QR encoding, byte mode, versions 1-10.
 *
 * Written here rather than pulled in as a dependency: this app ships as a
 * single self-hosted static bundle with no backend, and a QR encoder is a
 * bounded, well-specified problem. Versions 1-10 top out at 213 bytes at ECC M,
 * which comfortably covers the things labels actually carry -- bin numbers,
 * UPCs, short URLs.
 *
 * Like the 1D symbologies this returns MODULES, never pixels. The caller scales
 * by a whole number of device pixels; anything fractional gets destroyed by the
 * 1-bit threshold pass and produces a code that looks fine on screen and will
 * not scan.
 */

export type QrEcc = "L" | "M" | "Q" | "H";

/* --------------------------------------------------------------------------
 * GF(256), the field Reed-Solomon works over. Primitive polynomial 0x11D.
 * -------------------------------------------------------------------------- */

export const GF_EXP = new Uint8Array(512);
const EXP = GF_EXP;
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}

export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

/** Generator polynomial for `degree` error-correction codewords. */
function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let d = 0; d < degree; d++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let i = 0; i < poly.length; i++) {
      // Highest degree first, so poly[0] stays 1 and the division below can
      // treat gen[1..] as the tap coefficients. Building it the other way round
      // yields a reversed polynomial that still looks like a generator and
      // produces error-correction bytes that no scanner accepts.
      next[i] ^= poly[i]!;
      next[i + 1] ^= gfMul(poly[i]!, EXP[d]!);
    }
    poly = next;
  }
  return poly;
}

/** Exported for the syndrome test, which is what actually proves this correct. */
export function rsEncode(data: number[], ecLen: number): number[] {
  const gen = rsGenerator(ecLen);
  const rem = new Array<number>(ecLen).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0]!;
    rem.shift();
    rem.push(0);
    if (factor !== 0) {
      for (let i = 0; i < ecLen; i++) rem[i] ^= gfMul(gen[i + 1]!, factor);
    }
  }
  return rem;
}

/* --------------------------------------------------------------------------
 * Version / ECC capacity tables.
 *
 * Each entry: [ecCodewordsPerBlock, group1Blocks, group1Data, group2Blocks,
 * group2Data]. Group 2 blocks hold one more data codeword than group 1 and are
 * placed after them. A test asserts every row sums to the version's documented
 * total codeword count, which is what catches a transcription slip here.
 * -------------------------------------------------------------------------- */

type EccRow = readonly [number, number, number, number, number];

const CAPACITY: Record<QrEcc, readonly EccRow[]> = {
  L: [
    [7, 1, 19, 0, 0],
    [10, 1, 34, 0, 0],
    [15, 1, 55, 0, 0],
    [20, 1, 80, 0, 0],
    [26, 1, 108, 0, 0],
    [18, 2, 68, 0, 0],
    [20, 2, 78, 0, 0],
    [24, 2, 97, 0, 0],
    [30, 2, 116, 0, 0],
    [18, 2, 68, 2, 69],
  ],
  M: [
    [10, 1, 16, 0, 0],
    [16, 1, 28, 0, 0],
    [26, 1, 44, 0, 0],
    [18, 2, 32, 0, 0],
    [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0],
    [18, 4, 31, 0, 0],
    [22, 2, 38, 2, 39],
    [22, 3, 36, 2, 37],
    [26, 4, 43, 1, 44],
  ],
  Q: [
    [13, 1, 13, 0, 0],
    [22, 1, 22, 0, 0],
    [18, 2, 17, 0, 0],
    [26, 2, 24, 0, 0],
    [18, 2, 15, 2, 16],
    [24, 4, 19, 0, 0],
    [18, 2, 14, 4, 15],
    [22, 4, 18, 2, 19],
    [20, 4, 16, 4, 17],
    [24, 6, 19, 2, 20],
  ],
  H: [
    [17, 1, 9, 0, 0],
    [28, 1, 16, 0, 0],
    [22, 2, 13, 0, 0],
    [16, 4, 9, 0, 0],
    [22, 2, 11, 2, 12],
    [28, 4, 15, 0, 0],
    [26, 4, 13, 1, 14],
    [26, 4, 14, 2, 15],
    [24, 4, 12, 4, 13],
    [28, 6, 15, 2, 16],
  ],
};

/** Documented total codewords per version, for the table self-check. */
export const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

export const MAX_VERSION = 10;

/** Alignment pattern centre coordinates, indexed by version - 1. */
const ALIGNMENT: readonly (readonly number[])[] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

const ECC_BITS: Record<QrEcc, number> = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

function dataCapacityBytes(version: number, ecc: QrEcc): number {
  const [, g1, d1, g2, d2] = CAPACITY[ecc][version - 1]!;
  return g1 * d1 + g2 * d2;
}

/** Byte-mode character-count field width; it widens at version 10. */
function countBits(version: number): number {
  return version < 10 ? 8 : 16;
}

/** Smallest version that fits `byteLen`, or null if it does not fit at all. */
export function fitVersion(byteLen: number, ecc: QrEcc): number | null {
  for (let v = 1; v <= MAX_VERSION; v++) {
    const overheadBits = 4 + countBits(v);
    if (byteLen * 8 + overheadBits <= dataCapacityBytes(v, ecc) * 8) return v;
  }
  return null;
}

/* --------------------------------------------------------------------------
 * Bit stream
 * -------------------------------------------------------------------------- */

class BitBuffer {
  private bits: number[] = [];

  put(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
  }

  get length(): number {
    return this.bits.length;
  }

  toBytes(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | (this.bits[i + j] ?? 0);
      out.push(byte);
    }
    return out;
  }
}

/** UTF-8 bytes; QR byte mode is nominally Latin-1 but every scanner reads UTF-8. */
function toBytes(text: string): number[] {
  return [...new TextEncoder().encode(text)];
}

function buildCodewords(text: string, version: number, ecc: QrEcc): number[] {
  const bytes = toBytes(text);
  const capacity = dataCapacityBytes(version, ecc);

  const buf = new BitBuffer();
  buf.put(0b0100, 4); // byte mode
  buf.put(bytes.length, countBits(version));
  for (const b of bytes) buf.put(b, 8);

  // Terminator, up to four bits, then pad to a byte boundary.
  const remaining = capacity * 8 - buf.length;
  buf.put(0, Math.min(4, remaining));
  if (buf.length % 8 !== 0) buf.put(0, 8 - (buf.length % 8));

  const data = buf.toBytes();
  // Alternating pad bytes, as the spec fixes them.
  const PAD = [0xec, 0x11];
  for (let i = 0; data.length < capacity; i++) data.push(PAD[i % 2]!);

  // Split into blocks, error-correct each, then interleave.
  const [ecLen, g1, d1, g2, d2] = CAPACITY[ecc][version - 1]!;
  const blocks: { data: number[]; ec: number[] }[] = [];
  let offset = 0;
  for (let i = 0; i < g1 + g2; i++) {
    const size = i < g1 ? d1 : d2;
    const chunk = data.slice(offset, offset + size);
    offset += size;
    blocks.push({ data: chunk, ec: rsEncode(chunk, ecLen) });
  }

  const out: number[] = [];
  const maxData = Math.max(d1, d2);
  for (let i = 0; i < maxData; i++) {
    for (const b of blocks) if (i < b.data.length) out.push(b.data[i]!);
  }
  for (let i = 0; i < ecLen; i++) {
    for (const b of blocks) out.push(b.ec[i]!);
  }
  return out;
}

/* --------------------------------------------------------------------------
 * Matrix
 * -------------------------------------------------------------------------- */

const MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

interface Grid {
  size: number;
  dark: boolean[][];
  /** Function patterns and format areas, which masking and data placement skip. */
  reserved: boolean[][];
}

function newGrid(size: number): Grid {
  return {
    size,
    dark: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
    reserved: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
  };
}

function setFunction(g: Grid, r: number, c: number, dark: boolean): void {
  g.dark[r]![c] = dark;
  g.reserved[r]![c] = true;
}

function placeFinder(g: Grid, row: number, col: number): void {
  // 7x7 finder plus its one-module separator, clipped at the symbol edge.
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || rr >= g.size || cc < 0 || cc >= g.size) continue;
      const ring = r >= 0 && r <= 6 && (c === 0 || c === 6);
      const bar = c >= 0 && c <= 6 && (r === 0 || r === 6);
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      setFunction(g, rr, cc, ring || bar || core);
    }
  }
}

function placeFunctionPatterns(g: Grid, version: number): void {
  const size = g.size;
  placeFinder(g, 0, 0);
  placeFinder(g, 0, size - 7);
  placeFinder(g, size - 7, 0);

  // Timing patterns fill what the finders and separators left.
  for (let i = 0; i < size; i++) {
    if (!g.reserved[6]![i]) setFunction(g, 6, i, i % 2 === 0);
    if (!g.reserved[i]![6]) setFunction(g, i, 6, i % 2 === 0);
  }

  // Alignment patterns, except where they would sit on a finder.
  const centres = ALIGNMENT[version - 1]!;
  for (const r of centres) {
    for (const c of centres) {
      const onFinder =
        (r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6);
      if (onFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const edge = Math.max(Math.abs(dr), Math.abs(dc));
          setFunction(g, r + dr, c + dc, edge !== 1);
        }
      }
    }
  }

  // The module that is always dark.
  setFunction(g, size - 8, 8, true);

  // Reserve the format areas so data placement steps over them.
  for (let i = 0; i <= 8; i++) {
    if (!g.reserved[8]![i]) setFunction(g, 8, i, false);
    if (!g.reserved[i]![8]) setFunction(g, i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    if (!g.reserved[8]![size - 1 - i]) setFunction(g, 8, size - 1 - i, false);
    if (!g.reserved[size - 1 - i]![8]) setFunction(g, size - 1 - i, 8, false);
  }

  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const r = Math.floor(i / 3);
      const c = size - 11 + (i % 3);
      setFunction(g, r, c, false);
      setFunction(g, c, r, false);
    }
  }
}

/** Zigzag placement: two-module columns, right to left, skipping column 6. */
function placeData(g: Grid, codewords: number[]): void {
  const size = g.size;
  let bit = 0;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // the vertical timing column is not a data column
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (g.reserved[row]![col]) continue;
        const byte = codewords[bit >> 3] ?? 0;
        g.dark[row]![col] = ((byte >> (7 - (bit & 7))) & 1) === 1;
        bit++;
      }
    }
    upward = !upward;
  }
}

/** Penalty score; the mask with the lowest total wins. */
function penalty(dark: boolean[][], size: number): number {
  let score = 0;

  // Rule 1: runs of five or more.
  const runScore = (get: (i: number, j: number) => boolean) => {
    for (let i = 0; i < size; i++) {
      let run = 1;
      for (let j = 1; j < size; j++) {
        if (get(i, j) === get(i, j - 1)) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  };
  runScore((i, j) => dark[i]![j]!);
  runScore((i, j) => dark[j]![i]!);

  // Rule 2: 2x2 blocks of one colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = dark[r]![c];
      if (v === dark[r]![c + 1] && v === dark[r + 1]![c] && v === dark[r + 1]![c + 1]) {
        score += 3;
      }
    }
  }

  // Rule 3: finder-like sequences, which confuse a scanner's locator.
  const A = [true, false, true, true, true, false, true, false, false, false, false];
  const B = [false, false, false, false, true, false, true, true, true, false, true];
  const matches = (get: (k: number) => boolean, pattern: boolean[]) =>
    pattern.every((want, k) => get(k) === want);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j + 11 <= size; j++) {
      if (matches((k) => dark[i]![j + k]!, A) || matches((k) => dark[i]![j + k]!, B)) score += 40;
      if (matches((k) => dark[j + k]![i]!, A) || matches((k) => dark[j + k]![i]!, B)) score += 40;
    }
  }

  // Rule 4: deviation from an even balance of dark and light.
  let darkCount = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (dark[r]![c]) darkCount++;
  const percent = (darkCount * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/** 15-bit format information: 5 data bits, BCH(15,5), XOR-ed with a fixed mask. */
function formatBits(ecc: QrEcc, mask: number): number {
  const data = (ECC_BITS[ecc] << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) rem ^= 0b10100110111 << (i - 10);
  }
  return ((data << 10) | rem) ^ 0b101010000010010;
}

/** 18-bit version information, versions 7 and up. */
function versionBits(version: number): number {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((rem >> i) & 1) rem ^= 0b1111100100101 << (i - 12);
  }
  return (version << 12) | rem;
}

function applyFormat(g: Grid, ecc: QrEcc, mask: number): void {
  const bits = formatBits(ecc, mask);
  const size = g.size;
  const bit = (i: number) => ((bits >> i) & 1) === 1;

  for (let i = 0; i <= 5; i++) g.dark[8]![i] = bit(i);
  g.dark[8]![7] = bit(6);
  g.dark[8]![8] = bit(7);
  g.dark[7]![8] = bit(8);
  for (let i = 9; i <= 14; i++) g.dark[14 - i]![8] = bit(i);

  // The second copy splits 7 bits vertically and 8 horizontally -- NOT 8 and 7.
  // Taking one bit too many down the column writes over the always-dark module
  // at (size - 8, 8), which decoders use as a fixed reference.
  for (let i = 0; i <= 6; i++) g.dark[size - 1 - i]![8] = bit(i);
  for (let i = 7; i <= 14; i++) g.dark[8]![size - 15 + i] = bit(i);
}

function applyVersion(g: Grid, version: number): void {
  if (version < 7) return;
  const bits = versionBits(version);
  const size = g.size;
  for (let i = 0; i < 18; i++) {
    const on = ((bits >> i) & 1) === 1;
    const r = Math.floor(i / 3);
    const c = size - 11 + (i % 3);
    g.dark[r]![c] = on;
    g.dark[c]![r] = on;
  }
}

export interface QrSymbol {
  /** Modules per side, excluding the quiet zone. */
  size: number;
  /** Row-major; true is a dark module. */
  modules: boolean[][];
  version: number;
}

/**
 * Encode `text` to a QR symbol.
 *
 * Throws when the data cannot fit version 10 at the requested ECC level rather
 * than silently truncating -- a QR that scans as half a URL is worse than a
 * clear failure at design time.
 */
export function encodeQr(text: string, ecc: QrEcc = "M"): QrSymbol {
  const byteLen = toBytes(text).length;
  const version = fitVersion(byteLen, ecc);
  if (version === null) {
    throw new Error(`${byteLen} bytes is too long for QR version ${MAX_VERSION} at ECC ${ecc}`);
  }

  const codewords = buildCodewords(text, version, ecc);
  const size = 17 + 4 * version;

  const base = newGrid(size);
  placeFunctionPatterns(base, version);
  placeData(base, codewords);

  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const dark = base.dark.map((row) => [...row]);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!base.reserved[r]![c] && MASKS[mask]!(r, c)) dark[r]![c] = !dark[r]![c];
      }
    }
    const candidate: Grid = { size, dark, reserved: base.reserved };
    applyFormat(candidate, ecc, mask);
    applyVersion(candidate, version);

    const score = penalty(dark, size);
    if (score < bestScore) {
      bestScore = score;
      best = dark;
    }
  }

  return { size, modules: best!, version };
}
