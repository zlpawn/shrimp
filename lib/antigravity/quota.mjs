// Antigravity quota extension points.
//
// Each quota method is a small descriptor. Callers depend only on the
// retrieve* functions, so adding or changing an upstream quota RPC does not
// require touching subscription-auth routing, usage storage, or the UI.
import { decodeGenerateContentResponse } from "./proto-codec.mjs";
import { recordAntigravityUsage } from "./usage-store.mjs";
import { createH2Client, grpcUnary } from "./grpc.mjs";

export function unavailableAntigravityQuota(code, message) {
  return {
    available: false,
    remaining_percent: null,
    remaining_credits: null,
    consumed_credits: null,
    limits: [],
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
    remaining_percent: null,
    remaining_credits: remaining,
    consumed_credits: consumed,
    limits: [],
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
  const result = reader.buf.subarray(reader.pos, reader.pos + length);
  reader.pos += length;
  return result;
}

function decodeVarint(reader) {
  let value = 0;
  let exponent = 1;
  while (reader.pos < reader.len) {
    const byte = reader.buf[reader.pos++];
    value += exponent * (byte & 0x7f);
    if ((byte & 0x80) === 0) break;
    exponent *= 128;
  }
  return value;
}

function decodeQuotaGroup(buffer) {
  const reader = { buf: buffer, pos: 0, get len() { return buffer.length; } };
  const group = { quota: {} };
  while (reader.pos < reader.len) {
    const tag = reader.buf[reader.pos++];
    const field = tag >> 3;
    const wire = tag & 0x07;
    if (wire === 0) {
      group.quota["field" + field] = decodeVarint(reader);
      continue;
    }
    if (wire === 5) {
      if (reader.pos + 4 > reader.len) break;
      group["float" + field] = reader.buf.readFloatLE(reader.pos);
      if (field === 4 || field === 5) {
        group.quota.remaining_percent = group["float" + field] * 100;
      }
      reader.pos += 4;
      continue;
    }
    if (wire === 1) {
      if (reader.pos + 8 > reader.len) break;
      reader.pos += 8;
      continue;
    }
    if (wire !== 2) break;
    const valueBuffer = decodeLengthDelimited(reader);
    if (field === 1) group.id = valueBuffer.toString("utf8");
    else if (field === 2) group.title = valueBuffer.toString("utf8");
    else if (field === 3) group.window = valueBuffer.toString("utf8");
    else if (field === 6) {
      const quotaReader = { buf: valueBuffer, pos: 0, get len() { return valueBuffer.length; } };
      while (quotaReader.pos < quotaReader.len) {
        const quotaTag = quotaReader.buf[quotaReader.pos++];
        const quotaField = quotaTag >> 3;
        const quotaWire = quotaTag & 0x07;
        if (quotaWire === 0) {
          group.quota["field" + quotaField] = decodeVarint(quotaReader);
        } else if (quotaWire === 5) {
          if (quotaReader.pos + 4 > quotaReader.len) break;
          group.quota["field" + quotaField] = quotaReader.buf.readFloatLE(quotaReader.pos);
          quotaReader.pos += 4;
        } else if (quotaWire === 2) {
          decodeLengthDelimited(quotaReader);
        } else {
          break;
        }
      }
    } else if (field === 7) {
      group.description = valueBuffer.toString("utf8");
    }
  }
  return group;
}

function looksLikePrintableText(buffer) {
  if (!buffer.length) return false;
  for (const byte of buffer) {
    if (byte < 0x20 || byte > 0x7e) return false;
  }
  return true;
}

function decodeQuotaGroups(buffer, groups = []) {
  const reader = { buf: buffer, pos: 0, get len() { return buffer.length; } };
  while (reader.pos < reader.len) {
    const tag = reader.buf[reader.pos++];
    const field = tag >> 3;
    const wire = tag & 0x07;
    if (wire !== 2) break;
    const valueBuffer = decodeLengthDelimited(reader);
    if (field === 1) {
      groups.push(decodeQuotaGroup(valueBuffer));
    } else if (field === 2 && valueBuffer.length > 2 && valueBuffer[0] !== 0x47 && valueBuffer[0] !== 0x0a) {
      decodeQuotaGroups(valueBuffer, groups);
    } else if (field >= 2 && valueBuffer.length && valueBuffer[0] === 0x0a) {
      decodeQuotaGroups(valueBuffer, groups);
    }
  }
  return groups;
}

function collectAllQuotaGroups(buffer) {
  return decodeQuotaGroups(buffer);
}

function groupFor(group) {
  const id = String(group.id || "");
  if (id.startsWith("gemini-")) return "gemini";
  if (id.startsWith("3p-")) return "third_party";
  return "other";
}

function parseResetAfter(description = "") {
  const source = String(description);
  let match = source.match(/refresh in (\d+) days?, (\d+) hours?\./);
  if (match) return match[1] + " 天 " + match[2] + " 小时";
  match = source.match(/refresh in (\d+) hours?, (\d+) minutes?\./);
  if (match) return match[1] + " 小时 " + match[2] + " 分钟";
  match = source.match(/refresh in (\d+) hours?\./);
  if (match) return match[1] + " 小时";
  match = source.match(/refresh in (\d+) minutes?\./);
  if (match) return match[1] + " 分钟";
  return "";
}

function normalizeQuotaLimit(group) {
  const id = group.window === "weekly" ? "weekly" : group.window === "5h" ? "5h" : group.window || group.id || "";
  const normalizedInput = group.quota?.remaining_percent ?? group.remaining_percent;
  const raw = Number(normalizedInput ?? group.float4 ?? group.quota?.field5);
  const percent = Number.isFinite(raw)
    ? Math.max(0, Math.min(100, normalizedInput === undefined ? raw * 100 : raw))
    : null;
  return {
    id,
    group: groupFor(group),
    label: id === "weekly" ? "周额度" : id === "5h" ? "5 小时额度" : group.title || id,
    remaining_percent: percent,
    reset_after: parseResetAfter(group.description),
    reset_hint: "",
  };
}

export function normalizeUserQuotaSummaryForTests(payload) {
  const sourceGroups = Array.isArray(payload) ? payload : payload?.groups;
  const limits = (sourceGroups || [])
    .map(normalizeQuotaLimit)
    .filter((limit) => limit.group !== "other" || limit.id === "weekly" || limit.id === "5h");
  if (!limits.length) {
    return unavailableAntigravityQuota(
      "antigravity_quota_fields_unavailable",
      "Antigravity quota response did not contain recognizable quota groups.",
    );
  }
  return {
    available: true,
    remaining_percent: limits.find((limit) => limit.group === "gemini" && limit.id === "weekly")?.remaining_percent
      ?? limits.find((limit) => limit.id === "weekly")?.remaining_percent
      ?? limits[0].remaining_percent,
    remaining_credits: null,
    consumed_credits: null,
    limits,
    reset_hint: "",
    updated_at: new Date().toISOString(),
    error: null,
  };
}

function decodeUserQuotaSummary(buf) {
  const groups = [];
  const reader = { buf, pos: 0, get len() { return buf.length; } };
  while (reader.pos < reader.len) {
    const tag = reader.buf[reader.pos++];
    const field = tag >> 3;
    const wire = tag & 0x07;
    if (wire === 0) {
      decodeVarint(reader);
      continue;
    }
    if (wire === 5) {
      reader.pos += 4;
      continue;
    }
    if (wire === 1) {
      reader.pos += 8;
      continue;
    }
    if (wire !== 2) break;
    const valueBuffer = decodeLengthDelimited(reader);
    if (field === 2) {
      const gReader = { buf: valueBuffer, pos: 0, get len() { return valueBuffer.length; } };
      while (gReader.pos < gReader.len) {
        const gTag = gReader.buf[gReader.pos++];
        const gField = gTag >> 3;
        const gWire = gTag & 0x07;
        if (gWire === 0) {
          decodeVarint(gReader);
        } else if (gWire === 5) {
          gReader.pos += 4;
        } else if (gWire === 1) {
          gReader.pos += 8;
        } else if (gWire === 2) {
          const itemBuffer = decodeLengthDelimited(gReader);
          if (gField === 1) {
            groups.push(decodeQuotaGroup(itemBuffer));
          }
        } else {
          break;
        }
      }
    } else if (field === 1) {
      groups.push(decodeQuotaGroup(valueBuffer));
    }
  }
  return { groups };
}

function passthroughDecoder(payload) {
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
    normalize: normalizeUserQuotaSummaryForTests,
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

export function decodeUserQuotaSummaryForTests(payload) {
  return normalizeUserQuotaSummaryForTests(payload);
}
