/**
 * Print transports.
 *
 * A transport takes a MonoRaster and gets it onto paper. The MVP ships
 * PdfTransport (browser print dialog); WebUsbTransport slots in behind this
 * same interface later with no editor changes.
 *
 * NOTHING TRANSPORT-SPECIFIC MAY LEAK UPWARD. The editor knows about
 * MonoRaster and this interface -- never about PDFs, ZPL, or USB.
 */

import type { MonoRaster } from "./raster.ts";

export interface TransportCaps {
  dpi: number;
  /** Maximum printable width in device pixels, or null if unconstrained. */
  maxWidthPx: number | null;
  /** True if the transport goes through a system print dialog. */
  usesSystemDialog: boolean;
}

/** Quarter turns applied to the output at print time. */
export type PrintRotation = 0 | 90 | 180 | 270;

export interface PrintOptions {
  copies: number;
  /**
   * Rotate the output before sending it to the printer.
   *
   * Compensation for printer quirks we cannot otherwise reach. Thermal drivers
   * routinely rotate certain media -- the reference Rollo turns 2x1 stock 180
   * degrees while leaving 4x6 alone -- and a browser has no way to set a vendor
   * driver option. Doing it here means the fix travels with the label instead of
   * requiring every user to hand-build a CUPS queue.
   *
   * Print-time only: exported files stay unrotated, since they are archives and
   * may go to a different printer.
   */
  rotation?: PrintRotation;
}

export interface PrintResult {
  ok: boolean;
  /** Human-readable detail, present on failure. */
  message?: string;
}

export interface PrintTransport {
  readonly id: string;
  readonly label: string;
  isAvailable(): Promise<boolean>;
  capabilities(): TransportCaps;
  print(raster: MonoRaster, options: PrintOptions): Promise<PrintResult>;
  /**
   * Print several DIFFERENT labels as one job, for a merge run.
   *
   * Optional: `printAll` falls back to calling `print` in turn. Implementing it
   * matters most for transports that go through a system dialog, where the
   * fallback would ask the user to confirm a dialog per label.
   */
  printBatch?(rasters: readonly MonoRaster[], options: PrintOptions): Promise<PrintResult>;
}

const transports = new Map<string, PrintTransport>();

/**
 * Called from each transport's own `register.ts`, which is auto-discovered by
 * glob import. Never edit a central list to add a transport.
 */
export function registerTransport(transport: PrintTransport): void {
  transports.set(transport.id, transport);
}

export function getTransport(id: string): PrintTransport | undefined {
  return transports.get(id);
}

export function listTransports(): readonly PrintTransport[] {
  return [...transports.values()];
}

/**
 * Print a whole merge run.
 *
 * Stops at the first failure rather than pushing on. A batch that fails partway
 * leaves labels already on the roll, and the user needs to know which record
 * stopped it in order to resume -- continuing would waste the rest of the roll
 * printing labels nobody checked.
 */
export async function printAll(
  transport: PrintTransport,
  rasters: readonly MonoRaster[],
  options: PrintOptions,
): Promise<PrintResult> {
  if (rasters.length === 0) return { ok: false, message: "Nothing to print" };
  if (rasters.length === 1) return transport.print(rasters[0]!, options);
  if (transport.printBatch) return transport.printBatch(rasters, options);

  for (const [index, raster] of rasters.entries()) {
    const result = await transport.print(raster, options);
    if (!result.ok) {
      return {
        ok: false,
        message: `Stopped at label ${index + 1}: ${result.message ?? "unknown"}`,
      };
    }
  }
  return { ok: true };
}
