/**
 * Code 128, subsets B and C.
 *
 * The output is a run of modules, not pixels: a module is the narrowest bar the
 * symbology defines, and the caller decides how many device pixels one module
 * occupies. That separation is the whole point -- at 203 DPI a module MUST be a
 * whole number of pixels or the thresholding step lands bar edges wherever it
 * likes and scanners reject the result.
 *
 * Subset C packs two digits into one symbol, so it roughly halves the width of
 * numeric data. Encoding switches into it for long digit runs and back out for
 * anything else, which is what a hardware label printer does too.
 */

/**
 * Bar/space widths for symbol values 0..106, as the standard encodes them:
 * six digits per symbol, alternating bar and space, each digit a width in
 * modules. Value 106 (stop) has a seventh element.
 */
const PATTERNS = [
  "212222",
  "222122",
  "222221",
  "121223",
  "121322",
  "131222",
  "122213",
  "122312",
  "132212",
  "221213",
  "221312",
  "231212",
  "112232",
  "122132",
  "122231",
  "113222",
  "123122",
  "123221",
  "223211",
  "221132",
  "221231",
  "213212",
  "223112",
  "312131",
  "311222",
  "321122",
  "321221",
  "312212",
  "322112",
  "322211",
  "212123",
  "212321",
  "232121",
  "111323",
  "131123",
  "131321",
  "112313",
  "132113",
  "132311",
  "211313",
  "231113",
  "231311",
  "112133",
  "112331",
  "132131",
  "113123",
  "113321",
  "133121",
  "313121",
  "211331",
  "231131",
  "213113",
  "213311",
  "213131",
  "311123",
  "311321",
  "331121",
  "312113",
  "312311",
  "332111",
  "314111",
  "221411",
  "431111",
  "111224",
  "111422",
  "121124",
  "121421",
  "141122",
  "141221",
  "112214",
  "112412",
  "122114",
  "122411",
  "142112",
  "142211",
  "241211",
  "221114",
  "413111",
  "241112",
  "134111",
  "111242",
  "121142",
  "121241",
  "114212",
  "124112",
  "124211",
  "411212",
  "421112",
  "421211",
  "212141",
  "214121",
  "412121",
  "111143",
  "111341",
  "131141",
  "114113",
  "114311",
  "411113",
  "411311",
  "113141",
  "114131",
  "311141",
  "411131",
  "211412",
  "211214",
  "211232",
  "2331112",
];

const START_B = 104;
const START_C = 105;
const STOP = 106;
/** Switch to the other subset for the symbols that follow. */
const CODE_B = 100;
const CODE_C = 99;

/** Subset B covers printable ASCII 32..126, mapped to symbol values 0..94. */
function isEncodableB(code: number): boolean {
  return code >= 32 && code <= 126;
}

export function canEncodeCode128(value: string): boolean {
  if (value.length === 0) return false;
  for (const ch of value) {
    if (!isEncodableB(ch.charCodeAt(0))) return false;
  }
  return true;
}

/** Length of the digit run starting at `i`. */
function digitRun(value: string, i: number): number {
  let n = 0;
  while (i + n < value.length && value[i + n]! >= "0" && value[i + n]! <= "9") n++;
  return n;
}

/**
 * Whether subset C is worth entering at `i`.
 *
 * C needs an even count, and costs a switch symbol, so it only pays for a run
 * of four or more -- except at the very start or end, where six is the usual
 * rule of thumb but four still breaks even once the start symbol is free.
 */
function shouldUseC(value: string, i: number): boolean {
  const run = digitRun(value, i);
  if (i === 0 && run >= 4) return true;
  if (i + run === value.length && run >= 4 && run % 2 === 0) return true;
  return run >= 6;
}

/** Symbol values for `value`, excluding the check symbol and stop. */
function symbols(value: string): number[] {
  const out: number[] = [];
  let inC = shouldUseC(value, 0);
  out.push(inC ? START_C : START_B);

  let i = 0;
  while (i < value.length) {
    if (inC) {
      const run = digitRun(value, i);
      if (run >= 2) {
        out.push(Number(value.slice(i, i + 2)));
        i += 2;
        continue;
      }
      out.push(CODE_B);
      inC = false;
      continue;
    }

    if (shouldUseC(value, i) && digitRun(value, i) % 2 === 0) {
      out.push(CODE_C);
      inC = true;
      continue;
    }

    out.push(value.charCodeAt(i) - 32);
    i++;
  }
  return out;
}

/**
 * Encode to modules, `true` meaning a bar.
 *
 * Throws on unencodable input rather than substituting characters: a barcode
 * that scans as something other than what was asked for is worse than none.
 */
export function encodeCode128(value: string): boolean[] {
  if (!canEncodeCode128(value)) {
    throw new Error("Code 128 here supports printable ASCII only");
  }

  const syms = symbols(value);
  // Weighted mod-103 check symbol; the start symbol has weight 1, not 0.
  let sum = syms[0]!;
  for (let i = 1; i < syms.length; i++) sum += syms[i]! * i;
  syms.push(sum % 103);
  syms.push(STOP);

  const modules: boolean[] = [];
  for (const sym of syms) {
    let bar = true;
    for (const width of PATTERNS[sym]!) {
      for (let n = 0; n < Number(width); n++) modules.push(bar);
      bar = !bar;
    }
  }
  return modules;
}
