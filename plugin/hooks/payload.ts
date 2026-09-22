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
