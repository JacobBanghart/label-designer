/**
 * EAN-13, which also covers UPC-A.
 *
 * A UPC-A code is an EAN-13 with a leading zero, so a 12-digit UPC is accepted
 * and padded rather than rejected -- that is the form printed on retail goods,
 * and asking someone to prepend a zero by hand invites getting it wrong.
 *
 * Unlike Code 128 the width is fixed: 95 modules, always. Longer data is not
 * possible, which makes this the easy symbology to lay out and the strict one
 * to validate.
 */

/** Odd parity, left half. */
const L = [
  "0001101",
  "0011001",
  "0010011",
  "0111101",
  "0100011",
  "0110001",
  "0101111",
  "0111011",
  "0110111",
  "0001011",
];
/** Even parity, left half. */
const G = [
  "0100111",
  "0110011",
  "0011011",
  "0100001",
  "0011101",
  "0111001",
  "0000101",
  "0010001",
  "0001001",
  "0010111",
];
/** Right half; the complement of L. */
const R = [
  "1110010",
  "1100110",
  "1101100",
  "1000010",
  "1011100",
  "1001110",
  "1010000",
  "1000100",
  "1001000",
  "1110100",
];

/**
 * The first digit is not drawn as bars. It is encoded in which of the six
 * left-hand digits use odd vs even parity.
 */
const PARITY = [
  "LLLLLL",
  "LLGLGG",
  "LLGGLG",
  "LLGGGL",
  "LGLLGG",
  "LGGLLG",
  "LGGGLL",
  "LGLGLG",
  "LGLGGL",
  "LGGLGL",
];

/** Strip formatting people paste in from spreadsheets and barcode scanners. */
function normalise(value: string): string {
  return value.replace(/[\s-]/g, "");
}

/** The mod-10 check digit for 12 digits, weights alternating 1 and 3. */
export function ean13CheckDigit(twelve: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(twelve[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

export interface Ean13Check {
  ok: boolean;
  /** The full 13 digits, check digit computed if it was not supplied. */
  digits?: string;
  error?: string;
}

/**
 * Validate and normalise, accepting 12 or 13 digits.
 *
 * A 12-digit value gets its check digit computed. A 13-digit value has its
 * check digit VERIFIED and is rejected on mismatch -- a transposed digit that
 * still prints is exactly the failure that makes a whole run worthless.
 */
export function checkEan13(value: string): Ean13Check {
  const digits = normalise(value);
  if (!/^\d+$/.test(digits)) return { ok: false, error: "EAN-13 takes digits only" };

  if (digits.length === 12) {
    return { ok: true, digits: digits + ean13CheckDigit(digits) };
  }
  if (digits.length === 13) {
    const expected = ean13CheckDigit(digits.slice(0, 12));
    if (expected !== Number(digits[12])) {
      return { ok: false, error: `check digit should be ${expected}, not ${digits[12]}` };
    }
    return { ok: true, digits };
  }
  return { ok: false, error: `EAN-13 needs 12 or 13 digits, got ${digits.length}` };
}

/** Encode to 95 modules, `true` meaning a bar. */
export function encodeEan13(value: string): boolean[] {
  const check = checkEan13(value);
  if (!check.ok || !check.digits) throw new Error(check.error ?? "invalid EAN-13");
  const d = check.digits;

  let bits = "101";
  const parity = PARITY[Number(d[0])]!;
  for (let i = 0; i < 6; i++) {
    const digit = Number(d[i + 1]);
    bits += parity[i] === "L" ? L[digit] : G[digit];
  }
  bits += "01010";
  for (let i = 7; i < 13; i++) bits += R[Number(d[i])];
  bits += "101";

  return [...bits].map((b) => b === "1");
}
