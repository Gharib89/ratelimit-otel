import { expect, test } from "claude-code/testing";
import { buildPayload, identityFrom } from "./payload";

// 2025-09-21T19:20:00.000Z, with the window resetting 1800 seconds later.
const NOW = 1_758_482_400_000;
const RESETS_AT = "2025-09-21T19:50:00.000Z";

const IDENTITY = { email: "dev@example.com", accountId: "acct-1", sessionId: "sess-1" };

test("a five_hour window becomes ADR-0001's pair of gauges under the 5h spelling", () => {
  const payload = buildPayload(
    { rateLimits: [{ kind: "five_hour", percentUsed: 23.5, resetsAt: RESETS_AT }] },
    IDENTITY,
    NOW,
  );

  expect(payload).toEqual({
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "claude-code" } },
            { key: "user.email", value: { stringValue: "dev@example.com" } },
            { key: "user.account_id", value: { stringValue: "acct-1" } },
            { key: "session.id", value: { stringValue: "sess-1" } },
          ],
        },
        scopeMetrics: [
          {
            scope: { name: "cc-otel.plugin" },
            metrics: [
              {
                name: "claude_code.usage.utilization",
                gauge: {
                  dataPoints: [
                    {
                      timeUnixNano: "1758482400000000000",
                      asDouble: 23.5,
                      attributes: [
                        { key: "window", value: { stringValue: "5h" } },
                        { key: "resets_at", value: { stringValue: RESETS_AT } },
                      ],
                    },
                  ],
                },
              },
              {
                name: "claude_code.usage.reset_in_seconds",
                gauge: {
                  dataPoints: [
                    {
                      timeUnixNano: "1758482400000000000",
                      asDouble: 1800,
                      attributes: [
                        { key: "window", value: { stringValue: "5h" } },
                        { key: "resets_at", value: { stringValue: RESETS_AT } },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  });
});

test("a seven_day window becomes the 7d spelling", () => {
  const payload = buildPayload(
    { rateLimits: [{ kind: "seven_day", percentUsed: 7, resetsAt: RESETS_AT }] },
    IDENTITY,
    NOW,
  );

  const points = payload?.resourceMetrics[0].scopeMetrics[0].metrics[0]?.gauge.dataPoints;
  expect(points?.[0]?.attributes[0]).toEqual({ key: "window", value: { stringValue: "7d" } });
});

test("spend_limit is skipped rather than mapped onto a window", () => {
  const payload = buildPayload(
    {
      rateLimits: [
        { kind: "spend_limit", percentUsed: 112, resetsAt: RESETS_AT },
        { kind: "five_hour", percentUsed: 23.5, resetsAt: RESETS_AT },
      ],
    },
    IDENTITY,
    NOW,
  );

  const metrics = payload?.resourceMetrics[0].scopeMetrics[0].metrics;
  expect(metrics?.[0]?.gauge.dataPoints.map((p) => p.asDouble)).toEqual([23.5]);
  expect(metrics?.[1]?.gauge.dataPoints.map((p) => p.asDouble)).toEqual([1800]);
});

test("a window with no resetsAt emits utilization alone, with no resets_at attribute", () => {
  const payload = buildPayload(
    { rateLimits: [{ kind: "five_hour", percentUsed: 41 }] },
    IDENTITY,
    NOW,
  );

  const metrics = payload?.resourceMetrics[0].scopeMetrics[0].metrics;
  expect(metrics?.[0]?.gauge.dataPoints).toEqual([
    {
      timeUnixNano: "1758482400000000000",
      asDouble: 41,
      attributes: [{ key: "window", value: { stringValue: "5h" } }],
    },
  ]);
  expect(metrics?.[1]?.gauge.dataPoints).toEqual([]);
});

test("no window to emit is no payload at all", () => {
  expect(buildPayload({ rateLimits: [] }, IDENTITY, NOW)).toBe(undefined);
  expect(
    buildPayload({ rateLimits: [{ kind: "spend_limit", percentUsed: 3 }] }, IDENTITY, NOW),
  ).toBe(undefined);
});

test("an identity with no email still emits, carrying the session alone", () => {
  const payload = buildPayload(
    { rateLimits: [{ kind: "five_hour", percentUsed: 12, resetsAt: RESETS_AT }] },
    { sessionId: "sess-2" },
    NOW,
  );

  expect(payload?.resourceMetrics[0].resource.attributes).toEqual([
    { key: "service.name", value: { stringValue: "claude-code" } },
    { key: "session.id", value: { stringValue: "sess-2" } },
  ]);
});

test("rung 1 wins: the oauth account's email is lowercased and its uuid carried", () => {
  expect(
    identityFrom(
      { oauthAccount: { emailAddress: "Dev.One@Example.COM", accountUuid: "uuid-1" } },
      "user.email=env@example.com",
      "flag@example.com",
      "sess-1",
    ),
  ).toEqual({ email: "dev.one@example.com", accountId: "uuid-1", sessionId: "sess-1" });
});

test("rung 2: OTEL_RESOURCE_ATTRIBUTES answers when there is no oauth account", () => {
  expect(
    identityFrom(undefined, "service.name=claude-code,user.email=env@example.com", "flag@example.com", "sess-2"),
  ).toEqual({ email: "env@example.com", sessionId: "sess-2" });
});

test("rung 2 reads user.email as a whole key, not as a suffix of another one", () => {
  expect(
    identityFrom(undefined, "other.user.email=wrong@example.com,user.email=right@example.com", undefined, "s"),
  ).toEqual({ email: "right@example.com", sessionId: "s" });
  expect(identityFrom(undefined, "other.user.email=wrong@example.com", undefined, "s")).toEqual({
    sessionId: "s",
  });
  expect(identityFrom(undefined, " user.email = spaced@example.com ", undefined, "s")).toEqual({
    email: "spaced@example.com",
    sessionId: "s",
  });
});

test("rung 3: CLAUDE_USER_EMAIL answers when the resource attributes carry no email", () => {
  expect(identityFrom(undefined, "service.name=claude-code", "flag@example.com", "sess-3")).toEqual({
    email: "flag@example.com",
    sessionId: "sess-3",
  });
});

test("no rung answers: the sample still has an identity, with no email (ADR-0003)", () => {
  expect(identityFrom(undefined, undefined, undefined, "sess-4")).toEqual({ sessionId: "sess-4" });
});

test("an oauth account with no email falls through for the email and keeps the uuid", () => {
  expect(
    identityFrom({ oauthAccount: { accountUuid: "uuid-2" } }, undefined, "flag@example.com", "s"),
  ).toEqual({ email: "flag@example.com", accountId: "uuid-2", sessionId: "s" });
});

test("rung 2 treats an empty user.email as no answer and falls through", () => {
  expect(identityFrom(undefined, "user.email=,service.name=claude-code", "flag@example.com", "s")).toEqual({
    email: "flag@example.com",
    sessionId: "s",
  });
});
