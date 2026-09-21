import type { Hook, Register } from "claude-code";

/**
 * The skeleton's whole behavior: one debug line per session, so a load is
 * legible in `claude --debug` beside the manifest version the host reports.
 * `session.start` is also where the sampler's clock will start, so the
 * registration is the seam that work lands on rather than a placeholder.
 *
 * Declared at the top level because `$` may only be passed to a function
 * declared there.
 *
 * Measured on 2.1.278: in a `-p` run this line reaches neither the stream nor
 * `--debug-file`, because the session starts before the host is listening. A
 * `-p` host reports the load through the `init` event's `plugins` entry
 * instead, which carries the manifest version.
 */
const announceLoad: Hook<"session.start"> = ($, e, next) => {
  $.ui.log(`${$.plugin.name} loaded`, { to: "debug" });
  return next(e);
};

export const register: Register = (on) => {
  on("session.start", announceLoad);
};
