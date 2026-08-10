# WebUSB spike: can we skip the print dialog?

**Status:** research complete, no code written. **Recommendation: do not build
this yet, and never for the Rollo specifically.**

The plan was always that `WebUsbTransport` would slot in behind the existing
`PrintTransport` interface and let supported printers bypass the browser print
dialog. This is the feasibility check that was supposed to gate that work.

## Question 1: does Chrome even allow claiming a printer interface?

**Yes.** This was the assumption most likely to kill the whole idea, and it is
false.

WebUSB refuses to claim "protected interface classes" — `claimInterface()`
rejects with a `SecurityError` and logs _"An attempt to claim a USB device
interface has been blocked because it implements a protected interface class."_
The Chromium intent-to-ship for that filtering lists the protected classes as:

> Audio, Video, HID, Mass Storage, Smart Card, Wireless Controller (Bluetooth
> and Wireless USB)

**Printer (class `0x07`) is not on that list.** So the browser will let a page
claim a printer, given the user grants the device.

## Question 2: what does the reference printer actually expose?

Read directly from the attached Rollo:

```
idVendor  0x09c5  idProduct 0x0588   ("Memory Corp." / "Printer")
bDeviceClass 0
  bInterfaceClass    7  (Printer)
  bInterfaceSubClass 1
  bInterfaceProtocol 2  (Bidirectional)
  bNumEndpoints      2
    EP 0x81 IN   Bulk
    EP 0x02 OUT  Bulk
```

A textbook USB printer: one bulk OUT to send data, one bulk IN to read status.
Nothing exotic. If we knew what bytes to send, WebUSB could send them.

## Question 3: what actually blocks it, then?

Three things, in increasing order of severity.

### The kernel owns the device (Linux)

```
/sys/bus/usb/devices/3-1/3-1:1.0/  class=07  driver=usblp
/dev/usb/lp0 exists, usblp module loaded
```

`usblp` has claimed interface 0, and CUPS prints through it. Chrome cannot claim
an interface the kernel holds. The user would have to unbind `usblp` (or
blacklist it via udev), which **also removes the printer from CUPS** — so
enabling the fast path would break the working path. That is a bad trade to hand
a self-hoster.

### Windows needs a driver swap

Windows binds printer-class devices to `usbprint.sys`. WebUSB on Windows only
works against a WinUSB-bound device. A device can request WinUSB automatically
by publishing WebUSB/MS OS 2.0 descriptors, but a stock printer does not — so
users would need Zadig to forcibly replace the driver, which likewise breaks
normal printing.

For software whose pitch is "open a page and print," telling Windows users to
run a driver-replacement utility is a dealbreaker, not a caveat.

### We do not know what bytes to send (fatal, for this printer)

Even with a claimed interface and an open bulk endpoint, the transport needs a
command language. The Rollo's CUPS driver exposes vendor-specific options
(`roDarkness`, `roPrintRate`, `roMediaTracking`, `roAdjustHorizontal`,
`roFeedOffset`) which strongly implies a **proprietary raster format**, not ZPL
or ESC/POS. Reverse-engineering it means capturing USB traffic and inferring a
protocol — a project in its own right, with no guarantee of a stable result
across firmware.

## Conclusion

|                    |                                                          |
| ------------------ | -------------------------------------------------------- |
| Browser permits it | **Yes** — printer class is not protected                 |
| Hardware suits it  | **Yes** — plain bulk IN/OUT                              |
| Linux              | Requires unbinding `usblp`, which breaks CUPS printing   |
| Windows            | Requires Zadig; breaks normal printing                   |
| macOS              | Untested; likely a similar driver-claim problem          |
| Firefox / Safari   | No WebUSB at all                                         |
| Rollo protocol     | Undocumented; would need USB capture to reverse-engineer |

**The blocker was never the browser.** It is that claiming the device costs the
user their working print path, on every platform, and that this particular
printer speaks a language we would have to reverse-engineer first.

## If it is ever revisited

Do it for **ZPL and ESC/POS** printers, not the Rollo. Those languages are
documented, widely cloned, and a WebUSB transport for them is a few hundred
lines. Those are also the printers the PDF path serves _worst_, so the two
transports would cover genuinely different gaps rather than competing.

Scope it as: "if you have a ZPL or ESC/POS printer and are willing to unbind its
kernel driver, you can print without the dialog." That is an honest offer to a
narrow audience — and it is additive, because `PrintTransport` already exists and
`MonoRaster` is already the canonical artifact. Nothing about the current
architecture needs to change to accommodate it later.

## Sources

- [WebUSB API specification](https://wicg.github.io/webusb/) — `[[isProtectedClass]]`
  causes `claimInterface()` to reject with `SecurityError`
- [Intent to Implement and Ship: WebUSB Interface Class Filtering](https://groups.google.com/a/chromium.org/g/blink-dev/c/LZXocaeCwDw)
  — the protected class list
- [MDN: USBDevice.claimInterface()](https://developer.mozilla.org/en-US/docs/Web/API/USBDevice/claimInterface)
- Local `lsusb -v` and `/sys/bus/usb/devices` inspection of the attached printer
