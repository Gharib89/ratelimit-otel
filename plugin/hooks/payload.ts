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

type AttributeValue = { stringValue: string };
type Attribute = { key: string; value: AttributeValue };

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
