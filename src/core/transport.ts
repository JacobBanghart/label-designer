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
