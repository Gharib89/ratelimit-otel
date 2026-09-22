#!/usr/bin/env node
// Writes the version semantic-release graded into the plugin manifest.
//
// The manifest version is load-bearing rather than bookkeeping: the fleet
// measures rollout off the `plugin_loaded` event's version string (ADR-0001),
// so a release that leaves it stale is unmeasurable and nothing reports it.
// This throws rather than no-ops on a manifest it does not recognise, because a
// silent no-op here is exactly that failure again.
//
//   node scripts/set-manifest-version.mjs <version>

import { readFile, writeFile } from "node:fs/promises";

const MANIFEST = "plugin/.claude-plugin/plugin.json";

const version = process.argv[2];
if (!version) {
  throw new Error("usage: node scripts/set-manifest-version.mjs <version>");
}

const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
if (typeof manifest.version !== "string") {
  throw new Error(`${MANIFEST} has no string "version" field to write`);
}

manifest.version = version;
await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${MANIFEST}: version = ${version}`);
