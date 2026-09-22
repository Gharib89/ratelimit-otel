import type { EngineInterface, Hook, Register } from "claude-code";
import { accountAttributesFrom, buildPayload, headersFrom, identityFrom } from "./payload";

/** ADR-0003: a periodic sample, and the same five minutes as the per-seat delivery floor. */
const SAMPLE_INTERVAL_MS = 5 * 60_000;
const DELIVERY_FLOOR_MS = 5 * 60_000;

/**
 * The floor's only state, in `$.store`, which is kept between sessions and hot
 * reloads. Two concurrent sessions can lose an update to each other; the worst
 * case is one extra delivery, so there is no lock and no temp-and-rename here.
 *
 * The store's file name carries the install identity, so the floor resets once
 * if the install method changes (a `--plugin-dir` load and a marketplace install
 * do not share it).
 */
const LAST_DELIVERY_KEY = "last_delivery_at";

/** ADR-0001: the account attributes go out once per session, on the first delivery that lands. */
let accountAttributesSent = false;

/**
 * One sample: read the windows, deliver them, and hold the floor. Every failure
 * mode here is silent by design (ADR-0004) because the sampler runs in every
 * session on every seat, so a logged error would repeat on every seat the
 * console policy does not reach.
 */
async function sampleAndDeliver($: EngineInterface): Promise<void> {
  const now = await $.clock.now();
  const lastDeliveryAt = await $.store.get(LAST_DELIVERY_KEY);
  if (typeof lastDeliveryAt === "number" && now - lastDeliveryAt < DELIVERY_FLOOR_MS) return;

  // ADR-0004: where the console policy does not reach this scope there is no
  // endpoint, and the sample is skipped rather than queued or retried.
  // Trailing slashes are trimmed because the value is written by hand into the
  // console policy and a doubled path would 404 as silently as everything else.
  const endpoint = (await $.env.get("OTEL_EXPORTER_OTLP_ENDPOINT"))?.replace(/\/+$/, "");
  if (endpoint === undefined || endpoint === "") return;

  const usage = await $.session.usage();
  if (usage.rateLimits.length === 0) return;

  // A CLAUDE_CODE_OAUTH_TOKEN session writes no `oauthAccount`, and on CI the
  // file is absent altogether: both fall through to the ladder's later rungs.
  const home = await $.env.get("HOME");
  let claudeJson: unknown = undefined;
  if (home !== undefined) {
    claudeJson = await $.fs
      .read(`${home}/.claude.json`)
      .then((text) => JSON.parse(typeof text === "string" ? text : "{}") as unknown)
      .catch(() => undefined);
  }

  const identity = identityFrom(
    claudeJson,
    await $.env.get("OTEL_RESOURCE_ATTRIBUTES"),
    await $.env.get("CLAUDE_USER_EMAIL"),
    await $.session.id(),
  );
  const account = accountAttributesSent ? undefined : accountAttributesFrom(claudeJson);
  const payload = buildPayload(usage, { ...identity, ...(account === undefined ? {} : { account }) }, now);
  if (payload === undefined) return;

  // A refused connection is measured, not hypothetical: a cloud sandbox's egress
  // proxy resets this host before TLS (ADR-0003's amendment). It is caught here
  // because an uncaught rejection would surface the dead endpoint as a skipped
  // hook on every sample on every seat the console policy does not reach, which
  // is the one thing ADR-0004 says this failure must not do.
  const response = await $.http
    .fetch(`${endpoint}/v1/metrics`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headersFrom(await $.env.get("OTEL_EXPORTER_OTLP_HEADERS")),
      },
      body: JSON.stringify(payload),
    })
    .catch(() => undefined);
  if (response?.ok !== true) return;

  accountAttributesSent = true;
  await $.store.set(LAST_DELIVERY_KEY, now);
}

/**
 * One debug line per session, so a load is legible in `claude --debug` beside
 * the manifest version the host reports, and the sampling clock started. No
 * sample is taken here: `rateLimits` is empty until an API response lands
 * (ADR-0003).
 *
 * Both live in one hook because the engine refuses `on("session.start")` twice
 * without a matcher.
 *
 * Declared at the top level because `$` may only be passed to a function
 * declared there.
 */
const startSession: Hook<"session.start"> = ($, e, next) => {
  $.ui.log(`${$.plugin.name} loaded`, { to: "debug" });
  $.clock.every(SAMPLE_INTERVAL_MS, () => {
    void sampleAndDeliver($);
  });
  return next(e);
};

/** A completed turn is what guarantees a response landed, so it is where a sample is taken. */
const sampleOnTurn: Hook<"turn.complete"> = async ($, e, next) => {
  await sampleAndDeliver($);
  return next(e);
};

export const register: Register = (on) => {
  on("session.start", startSession);
  on("turn.complete", sampleOnTurn);
};
