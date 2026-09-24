import { expect, mock, test } from "claude-code/testing";
import type { HttpInit, On, SessionMeasureInput, SessionRateLimit } from "claude-code";

// 2025-09-21T19:20:00.000Z, with the window resetting 1800 seconds later.
const NOW = 1_758_482_400_000;
const RESETS_AT = "2025-09-21T19:50:00.000Z";
const ENDPOINT = "http://collector.invalid:4318";

const FIVE_HOUR: SessionRateLimit = { kind: "five_hour", percentUsed: 23.5, resetsAt: RESETS_AT };

type Post = { url: string; init: HttpInit | undefined };
type Response = { status: number; ok: boolean; headers: Record<string, string>; text: string };

/**
 * The world beneath the plugin for one sampler test: the mocked nouns, plus the
 * four the kit has no mock for, each answered from memory here.
 */
function world(
  on: On,
  options: {
    env?: Record<string, string>;
    /** Read on every sample, so a test can move a window between triggers. */
    rateLimits?: () => SessionRateLimit[];
    claudeJson?: unknown;
    /** A promise that never settles is how an unanswered POST is expressed. */
    respond?: () => Response | Promise<Response>;
    /** Read on every sample, so a test can move to a second session mid-run. */
    sessionId?: () => string;
    /** Answers `$.fs.read`; throwing it is how an unreadable `.claude.json` is expressed. */
    readClaudeJson?: (path: string) => string;
  } = {},
) {
  const clock = mock.clock(on, { now: NOW });
  mock.env(
    on,
    options.env ?? {
      HOME: "/home/dev",
      OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
      OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer tok=",
    },
  );

  const posts: Post[] = [];
  on("http.fetch", async (_$, e) => {
    posts.push({ url: e.url, init: e.init });
    return {
      value: (await options.respond?.()) ?? { status: 200, ok: true, headers: {}, text: '{"partialSuccess":{}}' },
    };
  });
  on("session.usage", () => ({
    value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: options.rateLimits?.() ?? [FIVE_HOUR] },
  }));
  on("session.id", () => ({ value: options.sessionId?.() ?? "sess-1" }));
  on("fs.read", (_$, e) => ({
    value: options.readClaudeJson?.(e.path) ?? JSON.stringify(options.claudeJson ?? {}),
  }));
  on("ui.log", () => ({ value: undefined }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.end", (_$, e) => ({ sessionId: e.sessionId }));

  return { clock, posts };
}

/** The resource attribute keys one post carried. */
const resourceKeys = (post: Post | undefined): string[] =>
  JSON.parse(post?.init?.body ?? "{}").resourceMetrics[0].resource.attributes.map(
    (a: { key: string }) => a.key,
  );

/** The plugin reads the windows off `$.session.usage()`, so this event's own are never consulted. */
const aMeasure: SessionMeasureInput = { context: { window: 200_000 }, rateLimits: [FIVE_HOUR], changed: ["rateLimits"] };
const anEnd = { reason: "other", sessionId: "sess-1", resume: { id: "sess-1" } } as const;

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

test("the engine measuring the session POSTs the sample as OTLP JSON to the endpoint's /v1/metrics", async ($, on) => {
  const { clock, posts } = world(on);

  await $.session.measure(aMeasure);
  await clock.settle();

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

test("a session starting takes no sample and starts no clock", async ($, on) => {
  const { clock, posts } = world(on);

  await $.session.start({ cwd: "/tmp", surface: null, isInteractive: false });
  await clock.advance(60 * 60_000);

  expect(posts.length).toBe(0);
});

test("a reading with no movement since the last delivery sends nothing, on either trigger", async ($, on) => {
  const { clock, posts } = world(on);

  await $.session.measure(aMeasure);
  await clock.settle();
  await $.session.measure(aMeasure);
  await clock.settle();
  await $.session.end(anEnd);

  expect(posts.length).toBe(1);
});

test("a whole-point move delivers and a sub-point move does not", async ($, on) => {
  let limits = [FIVE_HOUR];
  const { clock, posts } = world(on, { rateLimits: () => limits });

  await $.session.measure(aMeasure);
  await clock.settle();
  limits = [{ ...FIVE_HOUR, percentUsed: 23.9 }];
  await $.session.measure(aMeasure);
  await clock.settle();
  expect(posts.length).toBe(1);

  limits = [{ ...FIVE_HOUR, percentUsed: 24.1 }];
  await $.session.measure(aMeasure);
  await clock.settle();
  expect(posts.length).toBe(2);
});

test("a window that rolled over delivers at the same percentage", async ($, on) => {
  let limits = [FIVE_HOUR];
  const { clock, posts } = world(on, { rateLimits: () => limits });

  await $.session.measure(aMeasure);
  await clock.settle();
  limits = [{ ...FIVE_HOUR, resetsAt: "2025-09-22T00:50:00.000Z" }];
  await $.session.measure(aMeasure);
  await clock.settle();

  expect(posts.length).toBe(2);
});

test("a window appearing for the first time delivers", async ($, on) => {
  let limits = [FIVE_HOUR];
  const { clock, posts } = world(on, { rateLimits: () => limits });

  await $.session.measure(aMeasure);
  await clock.settle();
  limits = [FIVE_HOUR, { kind: "seven_day", percentUsed: 2.5 }];
  await $.session.measure(aMeasure);
  await clock.settle();

  expect(posts.length).toBe(2);
});

test("a movement of a window that maps to nothing is no movement", async ($, on) => {
  let limits: SessionRateLimit[] = [FIVE_HOUR, { kind: "spend_limit", percentUsed: 10 }];
  const { clock, posts } = world(on, { rateLimits: () => limits });

  await $.session.measure(aMeasure);
  await clock.settle();
  limits = [FIVE_HOUR, { kind: "spend_limit", percentUsed: 40 }];
  await $.session.measure(aMeasure);
  await clock.settle();

  expect(posts.length).toBe(1);
});

test("no endpoint means no send: the sample is skipped, not queued", async ($, on) => {
  const { clock, posts } = world(on, { env: { HOME: "/home/dev" } });

  await $.session.measure(aMeasure);
  await clock.settle();

  expect(posts.length).toBe(0);
});

test("an endpoint set to nothing is no endpoint", async ($, on) => {
  const { clock, posts } = world(on, { env: { HOME: "/home/dev", OTEL_EXPORTER_OTLP_ENDPOINT: "" } });

  await $.session.measure(aMeasure);
  await clock.settle();

  expect(posts.length).toBe(0);
});

test("a trailing slash on the endpoint does not become a doubled path", async ($, on) => {
  const { clock, posts } = world(on, { env: { HOME: "/home/dev", OTEL_EXPORTER_OTLP_ENDPOINT: `${ENDPOINT}/` } });

  await $.session.measure(aMeasure);
  await clock.settle();

  expect(posts[0]?.url).toBe(`${ENDPOINT}/v1/metrics`);
});

test("windows that map to nothing send nothing", async ($, on) => {
  const { clock, posts } = world(on, { rateLimits: () => [{ kind: "spend_limit", percentUsed: 112 }] });

  await $.session.measure(aMeasure);
  await clock.settle();

  expect(posts.length).toBe(0);
});

test("the account attributes go out on the first delivery and not on the next", async ($, on) => {
  let limits = [FIVE_HOUR];
  const { clock, posts } = world(on, {
    claudeJson: { oauthAccount: { emailAddress: "dev@example.com", seatTier: "enterprise" } },
    rateLimits: () => limits,
  });

  await $.session.measure(aMeasure);
  await clock.settle();
  limits = [{ ...FIVE_HOUR, percentUsed: 30 }];
  await $.session.measure(aMeasure);
  await clock.settle();

  expect(resourceKeys(posts[0])).toEqual(["service.name", "user.email", "session.id", "seat.tier"]);
  expect(resourceKeys(posts[1])).toEqual(["service.name", "user.email", "session.id"]);
});

test("a refused delivery leaves the movement pending, account attributes included", async ($, on) => {
  const { clock, posts } = world(on, {
    claudeJson: { oauthAccount: { emailAddress: "dev@example.com", seatTier: "enterprise" } },
    respond: () => ({ status: 503, ok: false, headers: {}, text: "unavailable" }),
  });

  await $.session.measure(aMeasure);
  await clock.settle();
  await $.session.measure(aMeasure);
  await clock.settle();

  expect(posts.length).toBe(2);
  expect(resourceKeys(posts[1])).toContain("seat.tier");
});

test("a rejected delivery leaves the movement pending", async ($, on) => {
  const { clock, posts } = world(on, {
    respond: () => {
      throw new Error("ECONNRESET");
    },
  });

  await $.session.measure(aMeasure);
  await clock.settle();
  await $.session.measure(aMeasure);
  await clock.settle();

  expect(posts.length).toBe(2);
});

test("each session delivers its own first reading, account attributes included", async ($, on) => {
  let sessionId = "sess-1";
  const { clock, posts } = world(on, {
    env: { HOME: "/home/dev", OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT },
    claudeJson: { oauthAccount: { emailAddress: "dev@example.com", seatTier: "enterprise" } },
    sessionId: () => sessionId,
  });

  await $.session.measure(aMeasure);
  await clock.settle();
  sessionId = "sess-2";
  await $.session.measure(aMeasure);
  await clock.settle();

  expect(posts.length).toBe(2);
  expect(resourceKeys(posts[0])).toContain("seat.tier");
  expect(resourceKeys(posts[1])).toContain("seat.tier");
});

test("no config directory and an unreadable .claude.json still emit, off the later rungs", async ($, on) => {
  const { clock, posts } = world(on, {
    env: {
      OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
      OTEL_RESOURCE_ATTRIBUTES: "user.email=env@example.com",
    },
    readClaudeJson: () => {
      throw new Error("ENOENT");
    },
  });

  await $.session.measure(aMeasure);
  await clock.settle();

  expect(posts.length).toBe(1);
  expect(JSON.parse(posts[0]?.init?.body ?? "{}").resourceMetrics[0].resource.attributes).toEqual([
    { key: "service.name", value: { stringValue: "claude-code" } },
    { key: "user.email", value: { stringValue: "env@example.com" } },
    { key: "session.id", value: { stringValue: "sess-1" } },
  ]);
});

/**
 * Answers only the one path Claude Code keeps its global config at. POSIX-shaped
 * even for a Windows seat: the test engine resolves a drive-letter path as
 * relative, and what these cases pin is which variable wins, not path syntax.
 */
const claudeJsonAt = (expected: string) => (path: string) => {
  if (path !== expected) throw new Error(`ENOENT: ${path}`);
  return JSON.stringify({ oauthAccount: { emailAddress: "dev@example.com", accountUuid: "acct-1" } });
};

test("a Windows seat with no HOME reads .claude.json from USERPROFILE", async ($, on) => {
  const { clock, posts } = world(on, {
    env: { USERPROFILE: "/users/dev", OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT },
    readClaudeJson: claudeJsonAt("/users/dev/.claude.json"),
  });

  await $.session.measure(aMeasure);
  await clock.settle();

  expect(resourceKeys(posts[0])).toEqual(["service.name", "user.email", "user.account_id", "session.id"]);
});

test("CLAUDE_CONFIG_DIR outranks HOME, as it does for Claude Code itself", async ($, on) => {
  const { clock, posts } = world(on, {
    env: { CLAUDE_CONFIG_DIR: "/d/claude", HOME: "/home/dev", OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT },
    readClaudeJson: claudeJsonAt("/d/claude/.claude.json"),
  });

  await $.session.measure(aMeasure);
  await clock.settle();

  expect(resourceKeys(posts[0])).toEqual(["service.name", "user.email", "user.account_id", "session.id"]);
});

test("a session ending with nothing delivered yet takes a sample", async ($, on) => {
  const { clock, posts } = world(on);

  await $.session.end(anEnd);

  expect(posts.length).toBe(1);
  expect(posts[0]?.url).toBe(`${ENDPOINT}/v1/metrics`);
});

test("a measurement returns before its POST settles, and the session end resends what never landed", async ($, on) => {
  let answer: () => Response | Promise<Response> = () => new Promise<Response>(() => {});
  const { clock, posts } = world(on, { respond: () => answer() });

  await $.session.measure(aMeasure);
  await clock.settle();
  expect(posts.length).toBe(1);

  answer = () => ({ status: 200, ok: true, headers: {}, text: "{}" });
  await $.session.end(anEnd);

  expect(posts.length).toBe(2);
});

test("an older delivery landing late does not move the gate back", async ($, on) => {
  let limits = [FIVE_HOUR];
  const answers: ((response: Response) => void)[] = [];
  const { clock, posts } = world(on, {
    rateLimits: () => limits,
    respond: () => new Promise<Response>((resolve) => answers.push(resolve)),
  });
  const ok: Response = { status: 200, ok: true, headers: {}, text: "{}" };

  await $.session.measure(aMeasure);
  await clock.settle();
  await clock.advance(1_000);
  limits = [{ ...FIVE_HOUR, percentUsed: 24.1 }];
  await $.session.measure(aMeasure);
  await clock.settle();
  answers[1]?.(ok);
  await clock.settle();
  answers[0]?.(ok);
  await clock.settle();

  await $.session.measure(aMeasure);
  await clock.settle();

  expect(posts.length).toBe(2);
});
