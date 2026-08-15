// Antigravity quota extension points. Transport adapters register method
// descriptors here; callers depend only on retrieveAntigravityQuota().
import { decodeGenerateContentResponse } from "./proto-codec.mjs";
import { recordAntigravityUsage } from "./usage-store.mjs";
import { createH2Client, grpcUnary } from "./grpc.mjs";

export function unavailableAntigravityQuota(code, message) {
  return {
    available: false,
    remaining_percent: null,
    remaining_credits: null,
    consumed_credits: null,
    updated_at: null,
    error: { code, message },
  };
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeAntigravityQuotaResponse(payload = {}) {
  const source = payload?.quota && typeof payload.quota === "object" ? payload.quota : payload;
  const remaining = numberOrNull(
    source.remainingCredits ?? source.remaining_credits ?? source.remainingQuota ?? source.remaining,
  );
  const consumed = numberOrNull(
    source.consumedCredits ?? source.consumed_credits ?? source.usedQuota ?? source.used,
  );
  if (remaining === null && consumed === null) {
    return unavailableAntigravityQuota(
      "antigravity_quota_fields_unavailable",
      "Antigravity quota response did not contain recognizable remaining/consumed fields.",
    );
  }
  return {
    available: true,
    remaining_credits: remaining,
    consumed_credits: consumed,
    updated_at: new Date().toISOString(),
    error: null,
  };
}

function decodeLengthDelimited(reader) {
  let length = 0;
  let shift = 0;
  while (true) {
    if (reader.pos >= reader.len) throw new Error("malformed protobuf length");
    const byte = reader.buf[reader.pos++];
    length |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return reader.buf.subarray(reader.pos, reader.pos + length);
}

function decodeUserQuotaSummary(buf) {
  const reader = { buf, pos: 0, get len() { return buf.length; } };
  const result = { groups: [] };
  while (reader.pos < reader.len) {
    const tag = reader.buf[reader.pos++];
    const fieldNumber = tag >> 3;
    const wireType = tag & 0x07;
    if (fieldNumber === 1 && wireType === 2) {
      const groupBuffer = decodeLengthDelimited(reader);
      const groupReader = { buf: groupBuffer, pos: 0, get len() { return groupBuffer.length; } };
      const group = {};
      while (groupReader.pos < groupReader.len) {
        const groupTag = groupReader.buf[groupReader.pos++];
        const groupField = groupTag >> 3;
        const groupWireType = groupTag & 0x07;
        if (groupWireType !== 2) continue;
        const valueBuffer = decodeLengthDelimited(groupReader);
        if (groupField === 1) group.id = valueBuffer.toString("utf8");
        else if (groupField === 2) group.title = valueBuffer.toString("utf8");
        else if (groupField === 3) group.window = valueBuffer.toString("utf8");
        else if (groupField === 6) {
          const valueReader = { buf: valueBuffer, pos: 0, get len() { return valueBuffer.length; } };
          const quota = {};
          while (valueReader.pos < valueReader.len) {
            const quotaTag = valueReader.buf[valueReader.pos++];
            const quotaField = quotaTag >> 3;
            const quotaWireType = quotaTag & 0x07;
            if (quotaField === 1 && quotaWireType === 0) {
              let value = 0;
              let exponent = 1;
              while (valueReader.pos < valueReader.len) {
                const byte = valueReader.buf[valueReader.pos++];
                value += exponent * (byte & 0x7f);
                if ((byte & 0x80) === 0) break;
                exponent *= 128;
              }
              quota["field" + quotaField] = value;
            } else if (quotaWireType === 2) {
              decodeLengthDelimited(valueReader);
            } else {
              break;
            }
          }
          group.quota = quota;
        }
        else if (groupField === 7) group.description = valueBuffer.toString("utf8");
      }
      result.groups.push(group);
    } else if (wireType === 2) {
      decodeLengthDelimited(reader);
    } else {
      break;
    }
  }
  return result;
}

function decodeUserQuotaSummaryNormalize(payload) {
  const groups = Array.isArray(payload.groups) ? payload.groups : [];
  const weekly = groups.find((group) => group.id === "gemini-weekly" || group.window === "weekly");
  const remaining = weekly?.quota?.field1 / 1_000_000;
  if (!Number.isFinite(Number(remaining))) return normalizeAntigravityQuotaResponse({});
  return {
    available: true,
    remaining_percent: Math.max(0, Math.min(100, Number(remaining))),
    remaining_credits: null,
    consumed_credits: null,
    reset_hint: weekly?.description || "",
    updated_at: new Date().toISOString(),
    error: null,
  };
}

function passthroughDecoder(payload) {
  // Quota responses are protobuf messages. Common wrapper fields (1/2) may
  // carry scalar quota values; decode them defensively instead of assuming a
  // known schema. This keeps adding methods a codec-only change.
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  let offset = 0;
  const values = {};
  while (offset < view.byteLength) {
    const tag = view.getUint8(offset++);
    const fieldNumber = tag >> 3;
    const wireType = tag & 0x07;
    if (wireType === 0) {
      let value = 0n;
      let shift = 0n;
      while (offset < view.byteLength) {
        const byte = view.getUint8(offset++);
        value |= BigInt(byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7n;
      }
      values["field" + fieldNumber] = Number(value);
    } else if (wireType === 2) {
      let length = 0;
      let shift = 0;
      while (offset < view.byteLength) {
        const byte = view.getUint8(offset++);
        length |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7;
      }
      values["field" + fieldNumber] = payload.subarray(offset, offset + length);
      offset += length;
    } else {
      break;
    }
  }
  return values;
}

export const quotaMethodRegistry = [
  {
    id: "RetrieveUserQuotaSummary",
    path: "/google.internal.cloud.code.v1internal.PredictionService/RetrieveUserQuotaSummary",
    request: () => Buffer.alloc(0),
    decode: decodeUserQuotaSummary,
    normalize: decodeUserQuotaSummaryNormalize,
  },
  {
    id: "RetrieveUserQuota",
    path: "/google.internal.cloud.code.v1internal.PredictionService/RetrieveUserQuota",
    request: () => Buffer.alloc(0),
    decode: decodeGenerateContentResponse,
    normalize: normalizeAntigravityQuotaResponse,
  },
  {
    id: "FetchQuotaStatus",
    path: "/google.cloud.businessaicode.v1.PredictionService/FetchQuotaStatus",
    request: () => Buffer.alloc(0),
    decode: passthroughDecoder,
    normalize: normalizeAntigravityQuotaResponse,
  },
];

export function registerAntigravityQuotaMethod(method) {
  if (!method?.id || !method?.path || typeof method.request !== "function") {
    throw new Error("quota method requires id, path, and request()");
  }
  const index = quotaMethodRegistry.findIndex((item) => item.id === method.id);
  if (index >= 0) quotaMethodRegistry[index] = method;
  else quotaMethodRegistry.push(method);
}

export async function retrieveAntigravityQuota({
  callUnary = null,
  methods = quotaMethodRegistry,
  fallback = null,
} = {}) {
  if (typeof callUnary !== "function") {
    return unavailableAntigravityQuota(
      "antigravity_quota_transport_unavailable",
      "No unary gRPC transport was supplied.",
    );
  }
  let lastError = null;
  for (const method of methods) {
    try {
      const payload = await callUnary(method);
      const usage = method.normalize(payload);
      if (usage.available) {
        recordAntigravityUsage(usage);
        return usage;
      }
      lastError = usage;
    } catch (error) {
      lastError = unavailableAntigravityQuota(
        "antigravity_quota_method_failed",
        method.id + ": " + (error?.message || String(error)),
      );
    }
  }
  if (lastError && typeof fallback === "function") {
    const fallbackUsage = fallback();
    if (fallbackUsage?.available) return fallbackUsage;
  }
  return lastError || unavailableAntigravityQuota(
    "antigravity_quota_methods_empty",
    "No Antigravity quota methods are registered.",
  );
}

export async function retrieveAntigravityQuotaViaGrpc({
  accessToken,
  proxyUrl = null,
  methods = quotaMethodRegistry,
  fallback = null,
} = {}) {
  const client = await createH2Client(proxyUrl);
  try {
    return await retrieveAntigravityQuota({
      methods,
      fallback,
      callUnary: async (method) => grpcUnary({
        client,
        path: method.path,
        requestBuffer: method.request(),
        decode: method.decode,
        accessToken,
      }),
    });
  } finally {
    client.destroy();
  }
}
