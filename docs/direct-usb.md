# Direct USB printing

Print straight to a thermal printer over WebUSB, with no print dialog, no CUPS,
and no vendor driver.

This exists because every printing bug this project hit lived in a layer between
the app and the printer: the browser's paper-size handling, CUPS's filters, and
a vendor driver that silently rotated 2×1 media 180° with no way for a web page
to correct it. Talking to the printer directly removes all of them.

## Does my printer work?

If it speaks **TSPL** (TSC Printer Language), yes. That covers TSC printers and
the many rebadges of them — including the Rollo this was developed against.

Check without installing anything:

```sh
strings /usr/lib/cups/filter/rastertoYOURPRINTER | grep -E "^(SIZE|BITMAP|PRINT|DENSITY)"
```

If you see `SIZE`, `BITMAP`, `DENSITY` and `PRINT`, it is TSPL and this will work.
That is exactly how support here was established — by reading what the vendor's
own filter emits, rather than trusting a datasheet.

Browser support is **Chrome or Edge**. Firefox and Safari do not implement
WebUSB, and there is no polyfill; those browsers get the print dialog instead.

## Linux: release the printer from the kernel

This is the one real cost. The kernel's `usblp` module claims printer-class
devices, and a browser cannot claim an interface the OS is holding.

**Detaching the printer from `usblp` also removes it from CUPS.** You are
choosing direct printing _instead of_ system printing for that device, not as
well as it. If you want both, keep a second printer or re-enable the module when
you need CUPS.

Find your printer's ids:

```sh
lsusb | grep -i printer
# Bus 003 Device 004: ID 09c5:0588 Memory Corp. Printer
```

Create `/etc/udev/rules.d/99-label-designer.rules`, substituting your ids:

```udev
# Keep usblp off this printer so a browser can claim it, and let your user open it.
ATTRS{idVendor}=="09c5", ATTRS{idProduct}=="0588", ENV{libsane_matched}="yes"
SUBSYSTEM=="usb", ATTRS{idVendor}=="09c5", ATTRS{idProduct}=="0588", MODE="0660", GROUP="plugdev"
ACTION=="add", SUBSYSTEM=="usb", ATTRS{idVendor}=="09c5", ATTRS{idProduct}=="0588", \
  RUN+="/bin/sh -c 'echo -n $kernel > /sys/bus/usb/drivers/usblp/unbind || true'"
```

Then:

```sh
sudo udevadm control --reload-rules
sudo udevadm trigger
# make sure you are in the group used above
groups | grep -q plugdev || sudo usermod -aG plugdev "$USER"   # log out and back in
```

Unplug and replug the printer. Confirm nothing holds it:

```sh
ls /dev/usb/lp*        # should be gone for this device
```

### Just testing?

Detach once, without a permanent rule:

```sh
# 3-1:1.0 is the device:interface from /sys/bus/usb/devices
echo -n '3-1:1.0' | sudo tee /sys/bus/usb/drivers/usblp/unbind
```

It comes back on replug.

## macOS and Windows

**macOS** usually allows claiming a printer interface without extra setup, but
this has not been tested.

**Windows** binds printer-class devices to `usbprint.sys`, and WebUSB needs a
WinUSB-bound device. Replacing the driver with Zadig works but breaks normal
printing, so on Windows the print dialog is the better route.

## Using it

1. Open the sidebar's **Direct USB** section and press **Connect printer**.
2. Pick your printer in the browser's chooser.
3. The Print button becomes **Print (USB)** and sends straight to the device.

Settings appear once connected, and are the ones the driver used to hide:

| Setting        | What it does                                         |
| -------------- | ---------------------------------------------------- |
| **Darkness**   | Burn intensity, 0–15                                 |
| **Speed**      | Feed speed, 1–8                                      |
| **Direction**  | Flip 180°, for stock that prints upside down         |
| **Offset X/Y** | Nudge the whole label; 13 dots ≈ 1/16″ at 203 DPI    |
| **Label gap**  | Millimetres between die-cut labels; 0 for continuous |

They are stored per browser, not per label, because they describe your hardware.

## If it fails to connect

_"Could not claim the printer"_ means the OS still holds it. Re-check the udev
step and confirm `/dev/usb/lp*` is gone for that device.

_No printer in the chooser_ means the browser sees no printer-class device.
Check `lsusb`, and that you are using Chrome or Edge.
