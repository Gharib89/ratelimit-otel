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

/** What a sample's records are attributed to; every field but the session is optional (ADR-0003). */
export type Identity = {
  email?: string;
  accountId?: string;
  sessionId: string;
  /** ADR-0001's account attributes, on the one sample of the session that carries them. */
  account?: Attribute[];
};

/**
 * Reads `user.email` out of an `OTEL_RESOURCE_ATTRIBUTES` value: comma-separated
 * `key=value` pairs. The key is matched whole, so `other.user.email=` is not a
 * hit, and both halves are trimmed, because the variable is written by hand.
 */
function emailFromResourceAttributes(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  for (const pair of value.split(",")) {
    const split = pair.indexOf("=");
    if (split < 0) continue;
    if (pair.slice(0, split).trim() !== "user.email") continue;
    const email = pair.slice(split + 1).trim();
    if (email !== "") return email;
  }
  return undefined;
}

const stringField = (source: unknown, field: string): string | undefined => {
  const value = (source as Record<string, unknown> | undefined)?.[field];
  return typeof value === "string" ? value : undefined;
};

/**
 * ADR-0003's identity ladder, first hit wins, over the three sources a hook
 * reads for it. The account uuid is carried whenever `~/.claude.json` has one,
 * independently of the ladder, since it is a resource attribute of its own
 * (ADR-0001) and the two later rungs cannot supply it.
 *
 * @param claudeJson the parsed `~/.claude.json`, or `undefined` when unreadable
 * @param resourceAttributes the `OTEL_RESOURCE_ATTRIBUTES` value
 * @param claudeUserEmail the `CLAUDE_USER_EMAIL` value
 * @param sessionId the session's id, always emitted
 */
export function identityFrom(
  claudeJson: unknown,
  resourceAttributes: string | undefined,
  claudeUserEmail: string | undefined,
  sessionId: string,
): Identity {
  const account = (claudeJson as Record<string, unknown> | undefined)?.["oauthAccount"];
  const email =
    stringField(account, "emailAddress")?.toLowerCase() ??
    emailFromResourceAttributes(resourceAttributes) ??
    claudeUserEmail;
  const accountId = stringField(account, "accountUuid");

  return {
    ...(email === undefined ? {} : { email }),
    ...(accountId === undefined ? {} : { accountId }),
    sessionId,
  };
}

type AttributeValue = { stringValue: string } | { boolValue: boolean };
export type Attribute = { key: string; value: AttributeValue };

/**
 * ADR-0001's account attributes, in its order, from `~/.claude.json`'s
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
 * Reads ADR-0001's account attributes off the parsed `~/.claude.json`, or
 * `undefined` where it carries no `oauthAccount` (a `CLAUDE_CODE_OAUTH_TOKEN`
 * session never writes one). A field the account does not carry is omitted.
 */
export function accountAttributesFrom(claudeJson: unknown): Attribute[] | undefined {
  const account = (claudeJson as Record<string, unknown> | undefined)?.["oauthAccount"];
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
 * Assembles one sample's OTLP JSON from the windows, the identity and the
 * instant, all three passed in so a test drives them.
 *
 * `undefined` when no window survived the mapping, which is the caller's whole
 * send gate: `rateLimits` is empty before the first API response, and a gateway
 * seat carries `spend_limit` alone.
 */
export function buildPayload(
  usage: { rateLimits: SessionRateLimit[] },
  identity: Identity,
  now: number,
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
    if (limit.resetsAt !== undefined) {
      resetInSeconds.push({
        timeUnixNano,
        asDouble: Math.floor((Date.parse(limit.resetsAt) - now) / 1000),
        attributes,
      });
    }
  }

  if (utilization.length === 0) return undefined;

  const resource = [attribute("service.name", "claude-code")];
  if (identity.email !== undefined) resource.push(attribute("user.email", identity.email));
  if (identity.accountId !== undefined) resource.push(attribute("user.account_id", identity.accountId));
  resource.push(attribute("session.id", identity.sessionId));
  if (identity.account !== undefined) resource.push(...identity.account);

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
