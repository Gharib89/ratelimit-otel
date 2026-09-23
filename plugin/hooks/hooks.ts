import type { EngineInterface, Hook, Register, SessionRateLimit } from "claude-code";
import { accountAttributesFrom, buildPayload, headersFrom, identityFrom, isEmitted } from "./payload";

/**
 * ADR-0005: the windows of the last delivery that landed, each as its whole
 * point and its `resetsAt`, for one session. In memory rather than `$.store`:
 * the comparison is per session, so nothing needs to outlive the process, and a
 * per-seat store would bring back the race between concurrent sessions.
 *
 * Keyed by the session rather than held bare, because nothing here settles
 * whether one module instance backs one session or outlives it. It doubles as
 * ADR-0001's once-per-session account attributes: they go out while nothing has
 * landed for this session.
 */
let landed: { sessionId: string; windows: Map<string, string> } | undefined;

/**
 * What an emitted window is compared on: a sub-point move is no movement, a
 * rollover is. A window that is never emitted cannot move.
 */
function windowsOf(rateLimits: readonly SessionRateLimit[]): Map<string, string> {
  const windows = new Map<string, string>();
  for (const limit of rateLimits) {
    if (!isEmitted(limit.kind)) continue;
    windows.set(limit.kind, `${Math.floor(limit.percentUsed)}|${limit.resetsAt ?? ""}`);
  }
  return windows;
}

/** A window moved when it is newly present or differs from what last landed for this session. */
function moved(sessionId: string, windows: Map<string, string>): boolean {
  if (landed?.sessionId !== sessionId) return true;
  for (const [kind, reading] of windows) {
    if (landed.windows.get(kind) !== reading) return true;
  }
  return false;
}

/**
 * One sample: read the windows and deliver them if one moved. Every failure
 * mode here is silent by design (ADR-0004) because the sampler runs in every
 * session on every seat, so a logged error would repeat on every seat the
 * console policy does not reach.
 *
 * The gate advances only on a delivery that landed, so a refused, rejected or
 * unanswered POST leaves the movement pending for the next trigger.
 */
async function sampleAndDeliver($: EngineInterface): Promise<void> {
  // ADR-0004: where the console policy does not reach this scope there is no
  // endpoint, and the sample is skipped rather than queued or retried.
  // Trailing slashes are trimmed because the value is written by hand into the
  // console policy and a doubled path would 404 as silently as everything else.
  const endpoint = (await $.env.get("OTEL_EXPORTER_OTLP_ENDPOINT"))?.replace(/\/+$/, "");
  if (endpoint === undefined || endpoint === "") return;

  const usage = await $.session.usage();
  if (usage.rateLimits.length === 0) return;
  const sessionId = await $.session.id();
  const windows = windowsOf(usage.rateLimits);
  if (!moved(sessionId, windows)) return;

  // A CLAUDE_CODE_OAUTH_TOKEN session writes no `oauthAccount`, and on CI the
  // file is absent altogether: both fall through to the ladder's later rungs.
  const home = await $.env.get("HOME");
  let claudeJson: unknown = undefined;
  if (home !== undefined) {
    claudeJson = await $.fs
      .read(`${home}/.claude.json`)
      .then((text) => JSON.parse(text) as unknown)
      .catch(() => undefined);
  }

  const identity = identityFrom({
    claudeJson,
    resourceAttributes: await $.env.get("OTEL_RESOURCE_ATTRIBUTES"),
    claudeUserEmail: await $.env.get("CLAUDE_USER_EMAIL"),
    sessionId,
  });
  const account = landed?.sessionId === sessionId ? undefined : accountAttributesFrom(claudeJson);
  const payload = buildPayload(usage, identity, await $.clock.now(), account);
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

  landed = { sessionId, windows };
}

/**
 * One debug line per session, so a load is legible in `claude --debug` beside
 * the manifest version the host reports. No sample is taken here: `rateLimits`
 * is empty until an API response lands (ADR-0003).
 */
const startSession: Hook<"session.start"> = ($, e, next) => {
  $.ui.log(`${$.plugin.name} loaded`, { to: "debug" });
  return next(e);
};

/**
 * The engine pushes a measurement after each main-thread turn and whenever a
 * window moves a whole point, a subagent's response included (ADR-0005), so it
 * is the sampler's clock. `e.changed` is not read: the movement gate decides.
 *
 * The POST is detached: awaited, one still running when the next prompt goes
 * out holds that turn's API request for 3 s (ADR-0005). `$` stays usable in the
 * detached work after the hook has returned.
 */
const sampleOnMeasure: Hook<"session.measure"> = ($, e, next) => {
  void sampleAndDeliver($);
  return next(e);
};

/**
 * The last sample of the session, awaited because a detached POST here is lost
 * every time. The same gate applies, so it POSTs only when a movement never
 * landed, one still in flight at exit included, bounded by the engine's 1.5 s
 * `session.end` budget.
 */
const sampleOnSessionEnd: Hook<"session.end"> = async ($, e, next) => {
  await sampleAndDeliver($);
  return next(e);
};

export const register: Register = (on) => {
  on("session.start", startSession);
  on("session.measure", sampleOnMeasure);
  on("session.end", sampleOnSessionEnd);
};
