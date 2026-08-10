/**
 * Direct USB printer connection and its settings.
 *
 * These settings describe the hardware, not the label, so they live per browser
 * rather than in a document -- and they are exactly the knobs that were
 * previously locked inside a driver: rotation, darkness, media gap, and
 * registration offset.
 */

import { useEffect, useState } from "react";

import { DEFAULT_TSPL_SETTINGS, type TsplSettings } from "../core/tspl.ts";
import {
  getGrantedDevice,
  isWebUsbSupported,
  loadTsplSettings,
  requestDevice,
  saveTsplSettings,
} from "../transports/webusb/index.ts";

interface Props {
  onConnectedChange: (connected: boolean) => void;
  /** Prints a calibration label with the settings as they currently stand. */
  onTestPrint: () => Promise<string | null>;
}

export function PrinterPanel({ onConnectedChange, onTestPrint }: Props) {
  const [testing, setTesting] = useState(false);
  const [device, setDevice] = useState<USBDevice | null>(null);
  const [settings, setSettings] = useState<TsplSettings>(() => loadTsplSettings());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getGrantedDevice().then((found) => {
      setDevice(found);
      onConnectedChange(found !== null);
    });
  }, [onConnectedChange]);

  const update = (patch: Partial<TsplSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveTsplSettings(next);
  };

  if (!isWebUsbSupported()) {
    return (
      <div className="printer-panel">
        <h2>Direct USB</h2>
        <p className="hint">
          This browser has no WebUSB. Chrome and Edge support it; Firefox and Safari do not. Use
          Print for the dialog route instead.
        </p>
      </div>
    );
  }

  return (
    <div className="printer-panel">
      <h2>Direct USB</h2>

      {device ? (
        <p className="hint">
          Connected: <strong>{device.productName ?? "printer"}</strong>
          {device.manufacturerName ? ` (${device.manufacturerName})` : ""}
        </p>
      ) : (
        <p className="hint">
          Print without the system dialog. Needs the printer detached from the OS driver first
          &mdash; see docs/direct-usb.md.
        </p>
      )}

      <button
        type="button"
        onClick={async () => {
          setError(null);
          const picked = await requestDevice();
          if (picked) {
            setDevice(picked);
            onConnectedChange(true);
          }
        }}
      >
        {device ? "Change printer" : "Connect printer"}
      </button>

      {error && <p className="error">{error}</p>}

      {device && (
        <>
          <div className="field">
            <span>Direction</span>
            <div className="segmented">
              {([0, 1] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={settings.direction === value ? "active" : ""}
                  onClick={() => update({ direction: value })}
                >
                  {value === 0 ? "Normal" : "Flipped"}
                </button>
              ))}
            </div>
            {/* This is the setting that was unreachable through the print
                dialog and made 2x1 stock print upside down. */}
            <p className="hint">Use Flipped if labels come out upside down.</p>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Darkness (0&ndash;15)</span>
              <input
                type="number"
                min={0}
                max={15}
                value={settings.density}
                onChange={(event) => update({ density: Number(event.target.value) })}
              />
            </label>
            <label className="field">
              <span>Speed (1&ndash;8)</span>
              <input
                type="number"
                min={1}
                max={8}
                value={settings.speed}
                onChange={(event) => update({ speed: Number(event.target.value) })}
              />
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Offset X (dots)</span>
              <input
                type="number"
                min={-200}
                max={200}
                value={settings.offsetXDots}
                onChange={(event) => update({ offsetXDots: Number(event.target.value) })}
              />
            </label>
            <label className="field">
              <span>Offset Y (dots)</span>
              <input
                type="number"
                min={-200}
                max={200}
                value={settings.offsetYDots}
                onChange={(event) => update({ offsetYDots: Number(event.target.value) })}
              />
            </label>
          </div>
          <p className="hint">
            Offsets nudge the whole label; 13 dots is about 1/16&Prime; at 203 DPI.
          </p>

          <label className="field">
            <span>Label gap (mm)</span>
            <input
              type="number"
              min={0}
              max={20}
              value={settings.gapMm}
              onChange={(event) => update({ gapMm: Number(event.target.value) })}
            />
          </label>

          {/*
            Adjusting a printer blind is miserable: every setting here is only
            verifiable by looking at a physical label. This keeps the loop to
            one click.
          */}
          <button
            type="button"
            className="primary"
            disabled={testing}
            onClick={async () => {
              setTesting(true);
              setError(await onTestPrint());
              setTesting(false);
            }}
          >
            {testing ? "Printing..." : "Print test label"}
          </button>
          <p className="hint">
            Prints a label with TOP at the top and an arrow pointing right. If TOP is at the bottom,
            switch Direction. If the corner ticks sit unevenly, adjust the offsets.
          </p>

          <button
            type="button"
            onClick={() => {
              setSettings({ ...DEFAULT_TSPL_SETTINGS });
              saveTsplSettings({ ...DEFAULT_TSPL_SETTINGS });
            }}
          >
            Reset to defaults
          </button>
        </>
      )}
    </div>
  );
}
