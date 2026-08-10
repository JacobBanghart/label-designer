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

export interface PrintOptions {
  copies: number;
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
