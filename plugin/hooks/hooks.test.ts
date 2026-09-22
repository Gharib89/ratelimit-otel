import { expect, mock, test } from "claude-code/testing";
import type { HttpInit, On, SessionRateLimit } from "claude-code";

// 2025-09-21T19:20:00.000Z, with the window resetting 1800 seconds later.
const NOW = 1_758_482_400_000;
const RESETS_AT = "2025-09-21T19:50:00.000Z";
const ENDPOINT = "http://collector.invalid:4318";

const FIVE_HOUR: SessionRateLimit = { kind: "five_hour", percentUsed: 23.5, resetsAt: RESETS_AT };

type Post = { url: string; init: HttpInit | undefined };

/**
 * The world beneath the plugin for one sampler test: the mocked nouns, plus the
 * four the kit has no mock for, each answered from memory here.
 */
function world(
  on: On,
  options: {
    env?: Record<string, string>;
    rateLimits?: SessionRateLimit[];
    claudeJson?: unknown;
    respond?: () => { status: number; ok: boolean; headers: Record<string, string>; text: string };
  } = {},
) {
  const clock = mock.clock(on, { now: NOW });
  mock.store(on);
  mock.env(
    on,
    options.env ?? {
      HOME: "/home/dev",
      OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
      OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer tok=",
    },
  );

  const posts: Post[] = [];
  on("http.fetch", (_$, e) => {
    posts.push({ url: e.url, init: e.init });
    return {
      value: options.respond?.() ?? { status: 200, ok: true, headers: {}, text: '{"partialSuccess":{}}' },
    };
  });
  on("session.usage", () => ({
    value: { context: { window: 200_000 }, rateLimits: options.rateLimits ?? [FIVE_HOUR] },
  }));
  on("session.id", () => ({ value: "sess-1" }));
  on("fs.read", () => ({ value: JSON.stringify(options.claudeJson ?? {}) }));
  on("ui.log", () => ({ value: undefined }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("turn.complete", (_$, e) => ({ text: e.answer }));

  return { clock, posts };
}

const aTurn = { answer: "done", durationMs: 1, isAborted: false, turnId: "t1", reason: "answer" } as const;

test("says it loaded on the debug log when a session starts", async ($, on) => {
  const logged: { text: string; to: string }[] = [];
  mock.clock(on, { now: NOW });
  on("ui.log", (_$, e) => {
    logged.push({ text: e.text, to: e.to });
    return { value: undefined };
  });
  on("session.start", (_$, e) => ({ cwd: e.cwd }));

  await $.session.start({ cwd: "/tmp", surface: null, isInteractive: false });

  expect(logged).toEqual([{ text: "ratelimit-otel loaded", to: "debug" }]);
});

test("a completed turn POSTs the sample as OTLP JSON to the endpoint's /v1/metrics", async ($, on) => {
  const { posts } = world(on);

  await $.turn.complete(aTurn);

  expect(posts.length).toBe(1);
  expect(posts[0]?.url).toBe(`${ENDPOINT}/v1/metrics`);
  expect(posts[0]?.init?.method).toBe("POST");
  expect(posts[0]?.init?.headers).toEqual({
    "Content-Type": "application/json",
    Authorization: "Bearer tok=",
  });

  const body = JSON.parse(posts[0]?.init?.body ?? "{}");
  const metrics = body.resourceMetrics[0].scopeMetrics[0].metrics;
  expect(metrics.map((m: { name: string }) => m.name)).toEqual([
    "claude_code.usage.utilization",
    "claude_code.usage.reset_in_seconds",
  ]);
  expect(metrics[0].gauge.dataPoints[0].asDouble).toBe(23.5);
});

test("a session starting takes no sample and starts the clock that does", async ($, on) => {
  const { clock, posts } = world(on);

  await $.session.start({ cwd: "/tmp", surface: null, isInteractive: false });
  expect(posts.length).toBe(0);

  await clock.advance(5 * 60_000);
  expect(posts.length).toBe(1);
});

test("the delivery floor holds a second sample inside five minutes and lets the next through", async ($, on) => {
  const { clock, posts } = world(on);

  await $.turn.complete(aTurn);
  await clock.advance(4 * 60_000);
  await $.turn.complete(aTurn);
  expect(posts.length).toBe(1);

  await clock.advance(60_000);
  await $.turn.complete(aTurn);
  expect(posts.length).toBe(2);
});

test("no endpoint means no send: the sample is skipped, not queued", async ($, on) => {
  const { posts } = world(on, { env: { HOME: "/home/dev" } });

  await $.turn.complete(aTurn);

  expect(posts.length).toBe(0);
});

test("an endpoint set to nothing is no endpoint", async ($, on) => {
  const { posts } = world(on, { env: { HOME: "/home/dev", OTEL_EXPORTER_OTLP_ENDPOINT: "" } });

  await $.turn.complete(aTurn);

  expect(posts.length).toBe(0);
});

test("a trailing slash on the endpoint does not become a doubled path", async ($, on) => {
  const { posts } = world(on, { env: { HOME: "/home/dev", OTEL_EXPORTER_OTLP_ENDPOINT: `${ENDPOINT}/` } });

  await $.turn.complete(aTurn);

  expect(posts[0]?.url).toBe(`${ENDPOINT}/v1/metrics`);
});

test("windows that map to nothing send nothing", async ($, on) => {
  const { posts } = world(on, { rateLimits: [{ kind: "spend_limit", percentUsed: 112 }] });

  await $.turn.complete(aTurn);

  expect(posts.length).toBe(0);
});

test("the account attributes go out on the first delivery and not on the next", async ($, on) => {
  const { clock, posts } = world(on, {
    claudeJson: { oauthAccount: { emailAddress: "dev@example.com", seatTier: "enterprise" } },
  });

  await $.turn.complete(aTurn);
  await clock.advance(5 * 60_000);
  await $.turn.complete(aTurn);

  const keys = (post: Post | undefined) =>
    JSON.parse(post?.init?.body ?? "{}").resourceMetrics[0].resource.attributes.map(
      (a: { key: string }) => a.key,
    );
  expect(keys(posts[0])).toEqual(["service.name", "user.email", "session.id", "seat.tier"]);
  expect(keys(posts[1])).toEqual(["service.name", "user.email", "session.id"]);
});

test("a refused delivery consumes neither the floor nor the account attributes", async ($, on) => {
  const { posts } = world(on, {
    claudeJson: { oauthAccount: { emailAddress: "dev@example.com", seatTier: "enterprise" } },
    respond: () => ({ status: 503, ok: false, headers: {}, text: "unavailable" }),
  });

  await $.turn.complete(aTurn);
  await $.turn.complete(aTurn);

  expect(posts.length).toBe(2);
  const attributes = JSON.parse(posts[1]?.init?.body ?? "{}").resourceMetrics[0].resource.attributes;
  expect(attributes.map((a: { key: string }) => a.key)).toContain("seat.tier");
});


test("the account attributes go out again in the next session", async ($, on) => {
  const posts: Post[] = [];
  const clock = mock.clock(on, { now: NOW });
  mock.store(on);
  mock.env(on, { HOME: "/home/dev", OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT });
  let sessionId = "sess-1";
  on("http.fetch", (_$, e) => {
    posts.push({ url: e.url, init: e.init });
    return { value: { status: 200, ok: true, headers: {}, text: '{"partialSuccess":{}}' } };
  });
  on("session.usage", () => ({ value: { context: { window: 200_000 }, rateLimits: [FIVE_HOUR] } }));
  on("session.id", () => ({ value: sessionId }));
  on("fs.read", () => ({
    value: JSON.stringify({ oauthAccount: { emailAddress: "dev@example.com", seatTier: "enterprise" } }),
  }));
  on("ui.log", () => ({ value: undefined }));
  on("turn.complete", (_$, e) => ({ text: e.answer }));

  await $.turn.complete(aTurn);
  await clock.advance(5 * 60_000);
  sessionId = "sess-2";
  await $.turn.complete(aTurn);

  const keys = (post: Post | undefined) =>
    JSON.parse(post?.init?.body ?? "{}").resourceMetrics[0].resource.attributes.map(
      (a: { key: string }) => a.key,
    );
  expect(keys(posts[0])).toContain("seat.tier");
  expect(keys(posts[1])).toContain("seat.tier");
});

test("no HOME and an unreadable ~/.claude.json still emit, off the later rungs", async ($, on) => {
  const posts: Post[] = [];
  mock.clock(on, { now: NOW });
  mock.store(on);
  mock.env(on, {
    OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
    OTEL_RESOURCE_ATTRIBUTES: "user.email=env@example.com",
  });
  on("http.fetch", (_$, e) => {
    posts.push({ url: e.url, init: e.init });
    return { value: { status: 200, ok: true, headers: {}, text: "{}" } };
  });
  on("session.usage", () => ({ value: { context: { window: 200_000 }, rateLimits: [FIVE_HOUR] } }));
  on("session.id", () => ({ value: "sess-1" }));
  on("fs.read", () => {
    throw new Error("ENOENT");
  });
  on("ui.log", () => ({ value: undefined }));
  on("turn.complete", (_$, e) => ({ text: e.answer }));

  await $.turn.complete(aTurn);

  expect(posts.length).toBe(1);
  expect(JSON.parse(posts[0]?.init?.body ?? "{}").resourceMetrics[0].resource.attributes).toEqual([
    { key: "service.name", value: { stringValue: "claude-code" } },
    { key: "user.email", value: { stringValue: "env@example.com" } },
    { key: "session.id", value: { stringValue: "sess-1" } },
  ]);
});
