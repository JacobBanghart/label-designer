/**
 * Direct-to-printer transport over WebUSB.
 *
 * Sends TSPL straight to the printer's bulk endpoint, skipping the print
 * dialog, CUPS, and the vendor driver entirely. That matters because every
 * failure this project hit while printing lived in one of those layers:
 * Chrome's paper handling, CUPS filters, and a driver that silently rotated 2x1
 * media 180 degrees with no way for a web page to correct it.
 *
 * Speaking TSPL ourselves turns each of those into a parameter we set.
 *
 * WHAT THIS COSTS: the browser can only claim an interface the operating system
 * is not holding. On Linux the kernel's usblp module claims printer-class
 * devices, so the printer must be detached from it first -- which also removes
 * it from CUPS. See docs/direct-usb.md.
 */

import { encodeTspl, type TsplSettings, DEFAULT_TSPL_SETTINGS } from "../../core/tspl.ts";
import type { MonoRaster } from "../../core/raster.ts";
import { DPI } from "../../core/units.ts";
import {
  registerTransport,
  type PrintOptions,
  type PrintResult,
  type PrintTransport,
  type TransportCaps,
} from "../../core/transport.ts";

/** USB printer class. Devices exposing it are candidates for direct printing. */
const USB_CLASS_PRINTER = 0x07;

/** Settings persist per browser, not per label: they describe the hardware. */
const SETTINGS_KEY = "label-designer:tspl";

export function loadTsplSettings(): TsplSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_TSPL_SETTINGS };
    return { ...DEFAULT_TSPL_SETTINGS, ...(JSON.parse(raw) as Partial<TsplSettings>) };
  } catch {
    return { ...DEFAULT_TSPL_SETTINGS };
  }
}

export function saveTsplSettings(settings: TsplSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // A lost preference is not worth interrupting a print for.
  }
}

export function isWebUsbSupported(): boolean {
  return typeof navigator !== "undefined" && "usb" in navigator;
}

/** A device the user has already granted this origin access to. */
export async function getGrantedDevice(): Promise<USBDevice | null> {
  if (!isWebUsbSupported()) return null;
  const devices = await navigator.usb.getDevices();
  return devices[0] ?? null;
}

/**
 * Prompt the user to pick a printer.
 *
 * Must be called from a user gesture -- browsers refuse the chooser otherwise.
 */
export async function requestDevice(): Promise<USBDevice | null> {
  if (!isWebUsbSupported()) return null;
  try {
    return await navigator.usb.requestDevice({
      filters: [{ classCode: USB_CLASS_PRINTER }],
    });
  } catch {
    // The user dismissed the chooser; not an error worth reporting.
    return null;
  }
}

interface Endpoint {
  interfaceNumber: number;
  endpointNumber: number;
}

/**
 * Find the printer's bulk OUT endpoint.
 *
 * Searched rather than hardcoded: the reference printer uses interface 0 and
 * endpoint 2, but that is a fact about one device, not about printers.
 */
function findBulkOut(device: USBDevice): Endpoint | null {
  for (const config of device.configurations) {
    for (const iface of config.interfaces) {
      for (const alt of iface.alternates) {
        if (alt.interfaceClass !== USB_CLASS_PRINTER) continue;
        for (const endpoint of alt.endpoints) {
          if (endpoint.direction === "out" && endpoint.type === "bulk") {
            return {
              interfaceNumber: iface.interfaceNumber,
              endpointNumber: endpoint.endpointNumber,
            };
          }
        }
      }
    }
  }
  return null;
}

/** Chunked so a large label does not fail on a single oversized transfer. */
const CHUNK_BYTES = 16 * 1024;

export async function sendToDevice(device: USBDevice, bytes: Uint8Array): Promise<PrintResult> {
  const endpoint = findBulkOut(device);
  if (!endpoint) return { ok: false, message: "That device has no bulk printer endpoint." };

  try {
    if (!device.opened) await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);
    await device.claimInterface(endpoint.interfaceNumber);

    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      const chunk = bytes.slice(offset, offset + CHUNK_BYTES);
      const result = await device.transferOut(endpoint.endpointNumber, chunk);
      if (result.status !== "ok") {
        return { ok: false, message: `Transfer ${result.status} after ${offset} bytes.` };
      }
    }

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The overwhelmingly common failure, and the one with a real remedy.
    if (/access|claim|denied|SecurityError|NetworkError/i.test(message)) {
      return {
        ok: false,
        message:
          "Could not claim the printer. The operating system is probably still holding it " +
          "(on Linux, the usblp kernel module). See docs/direct-usb.md.",
      };
    }
    return { ok: false, message };
  } finally {
    try {
      await device.releaseInterface(findBulkOut(device)?.interfaceNumber ?? 0);
    } catch {
      // Releasing is best-effort; the print has already been sent.
    }
  }
}

export const webUsbTransport: PrintTransport = {
  id: "webusb",
  label: "Direct to printer (USB)",

  async isAvailable(): Promise<boolean> {
    if (!isWebUsbSupported()) return false;
    return (await getGrantedDevice()) !== null;
  },

  capabilities(): TransportCaps {
    return { dpi: DPI, maxWidthPx: null, usesSystemDialog: false };
  },

  async print(raster: MonoRaster, options: PrintOptions): Promise<PrintResult> {
    const device = await getGrantedDevice();
    if (!device) {
      return { ok: false, message: "No printer connected. Use Connect printer first." };
    }

    const settings = loadTsplSettings();
    const bytes = encodeTspl(raster, { ...settings, copies: options.copies });
    return sendToDevice(device, bytes);
  },
};

registerTransport(webUsbTransport);
