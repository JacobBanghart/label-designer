/**
 * Module auto-discovery.
 *
 * Each transport and element drops a `register.ts` inside its OWN directory and
 * is picked up here automatically. This exists so that adding a module never
 * requires editing a shared file -- which is what lets several agents work
 * concurrently without conflicting.
 *
 * DO NOT add explicit imports to this file.
 */

import.meta.glob("../transports/*/register.ts", { eager: true });
import.meta.glob("../elements/*/register.ts", { eager: true });
