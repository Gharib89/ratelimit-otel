import type { SessionRateLimit } from "claude-code";

/**
 * OTLP payload assembly, pure: no `$`, so the whole emit contract is provable
 * without a collector. The names, values and attribute spellings below are
 * ADR-0001's table copied, not retyped: the downstream collector drops a record
 * under an unallowed name with a 200 and no error, so a wrong name here looks
 * healthy from the plugin and empties the mart.
 */

const SCOPE_NAME = "cc-otel.plugin";

/** ADR-0001: only these two window kinds have ever reached production. */
const WINDOW_BY_KIND: Record<string, string> = { five_hour: "5h", seven_day: "7d" };

/** Whether a window of this kind is emitted at all, so whether its movement is worth a delivery. */
export function isEmitted(kind: string): boolean {
  return WINDOW_BY_KIND[kind] !== undefined;
}

/** What a sample's records are attributed to; every field but the session is optional (ADR-0003). */
export type Identity = {
  email?: string;
  accountId?: string;
  sessionId: string;
};

/**
 * Splits the `key=value` list both `OTEL_RESOURCE_ATTRIBUTES` and
 * `OTEL_EXPORTER_OTLP_HEADERS` are written in: comma-separated pairs, split on
 * the first `=` alone so a value's own `=` stays in it, both halves trimmed
 * because the variables are written by hand, a pair with no `=` or no name
 * dropped, and a key repeated in the list takes its last value. A value
 * containing a comma is not representable in this format and is the producer's
 * to percent-encode.
 */
function parseKeyValueList(value: string | undefined): Record<string, string> {
  const pairs: Record<string, string> = {};
  if (value === undefined) return pairs;
  for (const pair of value.split(",")) {
    const split = pair.indexOf("=");
    if (split < 0) continue;
    const name = pair.slice(0, split).trim();
    if (name !== "") pairs[name] = pair.slice(split + 1).trim();
  }
  return pairs;
}

/** `.claude.json`'s `oauthAccount`, the object rung 1 and the account attributes both read. */
const oauthAccountOf = (claudeJson: unknown): unknown =>
  (claudeJson as Record<string, unknown> | undefined)?.["oauthAccount"];

const stringField = (source: unknown, field: string): string | undefined => {
  const value = (source as Record<string, unknown> | undefined)?.[field];
  return typeof value === "string" ? value : undefined;
};

/** What the ladder reads, named rather than positional: the three sources are otherwise transposable. */
export type IdentitySources = {
  /** The parsed `.claude.json`, or `undefined` when unreadable. */
  claudeJson: unknown;
  /** The `OTEL_RESOURCE_ATTRIBUTES` value. */
  resourceAttributes: string | undefined;
  /** The `CLAUDE_USER_EMAIL` value. */
  claudeUserEmail: string | undefined;
  /** The session's id, always emitted. */
  sessionId: string;
};

/**
 * ADR-0003's identity ladder, first hit wins, over the three sources a hook
 * reads for it. The account uuid is carried whenever `.claude.json` has one,
 * independently of the ladder, since it is a resource attribute of its own
 * (ADR-0001) and the two later rungs cannot supply it.
 */
export function identityFrom(sources: IdentitySources): Identity {
  const account = oauthAccountOf(sources.claudeJson);
  const fromResourceAttributes = parseKeyValueList(sources.resourceAttributes)["user.email"];
  const email =
    stringField(account, "emailAddress")?.toLowerCase() ??
    (fromResourceAttributes === "" ? undefined : fromResourceAttributes) ??
    sources.claudeUserEmail;
  const accountId = stringField(account, "accountUuid");

  return {
    ...(email === undefined ? {} : { email }),
    ...(accountId === undefined ? {} : { accountId }),
    sessionId: sources.sessionId,
  };
}

type AttributeValue = { stringValue: string } | { boolValue: boolean };
export type Attribute = { key: string; value: AttributeValue };

/**
 * ADR-0001's account attributes, in its order, from `.claude.json`'s
 * `oauthAccount`: the emitted key, the field it is read from, and how the value
 * crosses. The fields ADR-0001 excludes (`displayName`, `fullName`,
 * `accountCreatedAt`, `ccOnboardingFlags`, the trial pair) are absent from this
 * table, which is the whole of what keeps them off the wire.
 */
const ACCOUNT_ATTRIBUTES: { key: string; field: string; as: "string" | "bool" | "epochMsAsIso" }[] = [
  { key: "seat.tier", field: "seatTier", as: "string" },
  { key: "user.rate_limit_tier", field: "userRateLimitTier", as: "string" },
  { key: "organization.rate_limit_tier", field: "organizationRateLimitTier", as: "string" },
  { key: "organization.role", field: "organizationRole", as: "string" },
  { key: "organization.type", field: "organizationType", as: "string" },
  { key: "billing.type", field: "billingType", as: "string" },
  { key: "subscription.created_at", field: "subscriptionCreatedAt", as: "string" },
  { key: "extra_usage.enabled", field: "hasExtraUsageEnabled", as: "bool" },
  { key: "profile.fetched_at", field: "profileFetchedAt", as: "epochMsAsIso" },
];

/**
 * Reads ADR-0001's account attributes off the parsed `.claude.json`, or
 * `undefined` where it carries no `oauthAccount` (a `CLAUDE_CODE_OAUTH_TOKEN`
 * session never writes one). A field the account does not carry is omitted.
 */
export function accountAttributesFrom(claudeJson: unknown): Attribute[] | undefined {
  const account = oauthAccountOf(claudeJson);
  if (account === null || typeof account !== "object") return undefined;

  const attributes: Attribute[] = [];
  for (const { key, field, as } of ACCOUNT_ATTRIBUTES) {
    const value = (account as Record<string, unknown>)[field];
    if (as === "bool") {
      if (typeof value === "boolean") attributes.push({ key, value: { boolValue: value } });
    } else if (as === "epochMsAsIso") {
      if (typeof value === "number") attributes.push(attribute(key, new Date(value).toISOString()));
    } else if (typeof value === "string") {
      attributes.push(attribute(key, value));
    }
  }
  return attributes;
}

type DataPoint = {
  timeUnixNano: string;
  asDouble: number;
  attributes: Attribute[];
};

type Metric = { name: string; gauge: { dataPoints: DataPoint[] } };

export type OtlpPayload = {
  resourceMetrics: [
    {
      resource: { attributes: Attribute[] };
      scopeMetrics: [{ scope: { name: string }; metrics: Metric[] }];
    },
  ];
};

const attribute = (key: string, value: string): Attribute => ({ key, value: { stringValue: value } });

/**
 * Assembles one sample's OTLP JSON from the windows, the identity, the instant
 * and, on the one sample of the session that carries them, ADR-0001's account
 * attributes: all passed in so a test drives them.
 *
 * `undefined` when no window survived the mapping, which is the caller's whole
 * send gate: `rateLimits` is empty before the first API response, and a gateway
 * seat carries `spend_limit` alone.
 */
export function buildPayload(
  usage: { rateLimits: SessionRateLimit[] },
  identity: Identity,
  now: number,
  accountAttributes?: Attribute[],
): OtlpPayload | undefined {
  // Nanoseconds by string concatenation, not `now * 1e6`: the product is past
  // Number.MAX_SAFE_INTEGER and OTLP/JSON carries an int64 as a string anyway.
  const timeUnixNano = `${now}000000`;

  const utilization: DataPoint[] = [];
  const resetInSeconds: DataPoint[] = [];

  for (const limit of usage.rateLimits) {
    const window = WINDOW_BY_KIND[limit.kind];
    if (window === undefined) continue;

    const attributes = [attribute("window", window)];
    if (limit.resetsAt !== undefined) attributes.push(attribute("resets_at", limit.resetsAt));

    utilization.push({ timeUnixNano, asDouble: limit.percentUsed, attributes });
    // An unparseable `resetsAt` still carries verbatim as the attribute
    // (ADR-0002), but has no countdown to derive: `NaN` would cross as
    // `asDouble: null` and be a malformed datapoint delivered silently.
    const resetsAt = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt);
    if (!Number.isNaN(resetsAt)) {
      // Rounded up, not down: a consumer reconstructing the reset instant as
      // `ts + reset_in_seconds` bins it to five minutes, and a real window resets
      // on a five-minute boundary, so a countdown short by even the sub-second
      // part lands a whole bucket early. `ceil` puts the reconstruction in
      // `(reset, reset + 1s]`, inside the window's own bucket.
      resetInSeconds.push({ timeUnixNano, asDouble: Math.ceil((resetsAt - now) / 1000), attributes });
    }
  }

  if (utilization.length === 0) return undefined;

  const resource = [attribute("service.name", "claude-code")];
  if (identity.email !== undefined) resource.push(attribute("user.email", identity.email));
  if (identity.accountId !== undefined) resource.push(attribute("user.account_id", identity.accountId));
  resource.push(attribute("session.id", identity.sessionId));
  if (accountAttributes !== undefined) resource.push(...accountAttributes);

  return {
    resourceMetrics: [
      {
        resource: { attributes: resource },
        scopeMetrics: [
          {
            scope: { name: SCOPE_NAME },
            metrics: [
              { name: "claude_code.usage.utilization", gauge: { dataPoints: utilization } },
              { name: "claude_code.usage.reset_in_seconds", gauge: { dataPoints: resetInSeconds } },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Reads `OTEL_EXPORTER_OTLP_HEADERS` into request headers. Values cross
 * verbatim, undecoded, which is the form ADR-0004 measured a delivery on.
 */
export function headersFrom(value: string | undefined): Record<string, string> {
  return parseKeyValueList(value);
}
