/**
 * Auto-discovered via glob import -- registers pdfTransport with the central
 * transport registry. Never edit a central list to add a transport.
 */

import { registerTransport } from "../../core/transport.ts";

import { pdfTransport } from "./index.ts";

registerTransport(pdfTransport);
