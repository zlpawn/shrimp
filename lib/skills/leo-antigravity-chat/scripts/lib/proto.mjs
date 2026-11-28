// Zero-dependency Protobuf codec for Antigravity v1internal GenerateContent & Quota.

const WT_VARINT = 0;
const WT_LEN = 2;
const WT_32BIT = 5;

function encodeVarint(n) {
  if (typeof n !== "number" || n < 0 || !Number.isFinite(n)) n = 0;
  const bytes = [];
  while (n > 0x7f) {
    bytes.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  bytes.push(n & 0x7f);
  return Buffer.from(bytes);
}

function tag(fieldNum, wireType) {
  return encodeVarint((fieldNum << 3) | wireType);
}

function encStr(fieldNum, str) {
  const b = Buffer.from(String(str), "utf8");
  return Buffer.concat([tag(fieldNum, WT_LEN), encodeVarint(b.length), b]);
}

function encBytes(fieldNum, buf) {
  return Buffer.concat([tag(fieldNum, WT_LEN), encodeVarint(buf.length), buf]);
}

function encMsg(fieldNum, buf) {
  return Buffer.concat([tag(fieldNum, WT_LEN), encodeVarint(buf.length), buf]);
}

function encVarintField(fieldNum, val) {
  return Buffer.concat([tag(fieldNum, WT_VARINT), encodeVarint(val)]);
}

function encFloat(fieldNum, val) {
  const b = Buffer.alloc(4);
  b.writeFloatLE(val, 0);
  return Buffer.concat([tag(fieldNum, WT_32BIT), b]);
}

function encBool(fieldNum, val) {
  return encVarintField(fieldNum, val ? 1 : 0);
}

function concatBufs(arr) {
  return Buffer.concat(arr.filter((b) => b && b.length > 0));
}

function encodeInlineData(data) {
  const f = [];
  if (data.mimeType) f.push(encStr(1, data.mimeType));
  if (data.data) f.push(encBytes(2, Buffer.from(data.data, "base64")));
  return concatBufs(f);
}

function encodePart(part) {
  const f = [];
  if (part.text != null) f.push(encStr(1, part.text));
  if (part.inlineData) f.push(encMsg(2, encodeInlineData(part.inlineData)));
  if (part.thought != null) f.push(encBool(10, part.thought));
  if (part.thoughtSignature) {
    const buf = Buffer.isBuffer(part.thoughtSignature)
      ? part.thoughtSignature
      : Buffer.from(part.thoughtSignature, "base64");
    if (buf && buf.length > 0) {
      f.push(encBytes(11, buf));
    }
  }
  return concatBufs(f);
}

function encodeContent(content) {
  const f = [];
  if (content.role) f.push(encStr(1, content.role));
  if (Array.isArray(content.parts)) {
    for (const p of content.parts) f.push(encMsg(2, encodePart(p)));
  }
  return concatBufs(f);
}

function encodeThinkingConfig(tc) {
  const f = [];
  if (tc.includeThoughts != null) f.push(encBool(1, tc.includeThoughts));
  if (tc.thinkingBudget != null) f.push(encVarintField(3, tc.thinkingBudget));
  return concatBufs(f);
}

function encodeGenerationConfig(gc) {
  const f = [];
  if (gc.temperature != null) f.push(encFloat(1, gc.temperature));
  if (gc.topP != null) f.push(encFloat(2, gc.topP));
  if (gc.topK != null) f.push(encFloat(3, gc.topK));
  if (gc.maxOutputTokens != null) f.push(encVarintField(5, gc.maxOutputTokens));
  if (Array.isArray(gc.responseModalities) && gc.responseModalities.length > 0) {
    const modalityMap = { TEXT: 1, IMAGE: 2, VIDEO: 3, AUDIO: 4, DOCUMENT: 5 };
    const vals = gc.responseModalities.map((m) => modalityMap[m] ?? 0).filter((v) => v > 0);
    if (vals.length > 0) {
      f.push(encBytes(21, concatBufs(vals.map((v) => encodeVarint(v)))));
    }
  }
  if (gc.thinkingConfig) {
    const tcBuf = encodeThinkingConfig(gc.thinkingConfig);
    if (tcBuf.length > 0) f.push(encMsg(25, tcBuf));
  }
  return concatBufs(f);
}

function encodeMasterRequest(req) {
  const f = [];
  if (req.endpoint) f.push(encStr(1, req.endpoint));
  if (Array.isArray(req.contents)) {
    for (const c of req.contents) f.push(encMsg(2, encodeContent(c)));
  }
  if (req.generationConfig) {
    const gcBuf = encodeGenerationConfig(req.generationConfig);
    if (gcBuf.length > 0) f.push(encMsg(4, gcBuf));
  }
  if (req.model) f.push(encStr(5, req.model));
  if (req.systemInstruction) f.push(encMsg(8, encodeContent(req.systemInstruction)));
  if (req.sessionId) f.push(encStr(13, req.sessionId));
  return concatBufs(f);
}

export function encodeGenerateContentRequest(body) {
  const f = [];
  if (body.project) f.push(encStr(1, body.project));
  if (body.requestId) f.push(encStr(2, body.requestId));
  if (body.request) f.push(encMsg(3, encodeMasterRequest(body.request)));
  if (body.model) f.push(encStr(4, body.model));
  if (body.userPromptId) f.push(encStr(5, body.userPromptId));
  if (body.userAgent) f.push(encStr(6, body.userAgent));
  if (body.requestType) f.push(encStr(7, body.requestType));
  if (Array.isArray(body.enabledCreditTypes)) {
    const creditMap = { GOOGLE_ONE_AI: 1, CREDIT_TYPE_UNSPECIFIED: 0 };
    for (const ct of body.enabledCreditTypes) {
      f.push(encVarintField(8, creditMap[ct] ?? 0));
    }
  }
  return concatBufs(f);
}

const FINISH_REASON_MAP = {
  FINISH_REASON_UNSPECIFIED: 0,
  STOP: 1,
  MAX_TOKENS: 2,
  SAFETY: 3,
  RECITATION: 4,
  OTHER: 5,
  BLOCKLIST: 6,
  PROHIBITED_CONTENT: 7,
  IMAGE_SAFETY: 11,
};

function encodeUsageMetadata(um) {
  const f = [];
  if (um.promptTokenCount != null) f.push(encVarintField(1, um.promptTokenCount));
  if (um.candidatesTokenCount != null) f.push(encVarintField(2, um.candidatesTokenCount));
  if (um.totalTokenCount != null) f.push(encVarintField(3, um.totalTokenCount));
  if (um.cachedContentTokenCount != null) f.push(encVarintField(5, um.cachedContentTokenCount));
  if (um.thoughtsTokenCount != null) f.push(encVarintField(14, um.thoughtsTokenCount));
  return concatBufs(f);
}

function encodeCandidate(c) {
  const f = [];
  if (c.content) f.push(encMsg(2, encodeContent(c.content)));
  if (c.finishReason) f.push(encVarintField(3, FINISH_REASON_MAP[c.finishReason] ?? 0));
  if (c.finishMessage) f.push(encStr(5, c.finishMessage));
  return concatBufs(f);
}

function encodeMasterResponse(resp) {
  const f = [];
  if (Array.isArray(resp.candidates)) {
    for (const c of resp.candidates) f.push(encMsg(2, encodeCandidate(c)));
  }
  if (resp.usageMetadata) f.push(encMsg(4, encodeUsageMetadata(resp.usageMetadata)));
  if (resp.modelVersion) f.push(encStr(11, resp.modelVersion));
  if (resp.responseId) f.push(encStr(13, resp.responseId));
  return concatBufs(f);
}

export function encodeGenerateContentResponse(obj) {
  const f = [];
  if (obj.response) f.push(encMsg(1, encodeMasterResponse(obj.response)));
  if (obj.traceId) f.push(encStr(2, obj.traceId));
  if (obj.consumedCredits != null) f.push(encVarintField(3, obj.consumedCredits));
  if (obj.remainingCredits != null) f.push(encVarintField(4, obj.remainingCredits));
  return concatBufs(f);
}

class Reader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
    this.len = buf.length;
  }

  uint32() {
    let result = 0;
    let shift = 0;
    while (this.pos < this.len) {
      const b = this.buf[this.pos++];
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 35) {
        while (this.pos < this.len && this.buf[this.pos - 1] & 0x80) this.pos++;
        break;
      }
    }
    return result >>> 0;
  }

  tag() {
    const val = this.uint32();
    return { fieldNum: val >>> 3, wireType: val & 7 };
  }

  bytes() {
    const len = this.uint32();
    const end = this.pos + len;
    const result = this.buf.subarray(this.pos, end);
    this.pos = end;
    return result;
  }

  string() {
    return this.bytes().toString("utf8");
  }

  bool() {
    return this.uint32() !== 0;
  }

  int32() {
    return this.uint32() | 0;
  }

  skip(wt) {
    switch (wt) {
      case 0:
        this.uint32();
        break;
      case 1:
        this.pos += 8;
        break;
      case 2: {
        const len = this.uint32();
        this.pos += len;
        break;
      }
      case 5:
        this.pos += 4;
        break;
      default:
        this.pos = this.len;
        break;
    }
  }
}

const FINISH_REASONS = [
  "FINISH_REASON_UNSPECIFIED",
  "STOP",
  "MAX_TOKENS",
  "SAFETY",
  "RECITATION",
  "OTHER",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "MALFORMED_FUNCTION_CALL",
  "MODEL_ARMOR",
  "IMAGE_SAFETY",
  "IMAGE_PROHIBITED_CONTENT",
  "IMAGE_RECITATION",
  "IMAGE_OTHER",
  "UNEXPECTED_TOOL_CALL",
  "NO_IMAGE",
];

function decodeInlineData(buf) {
  const reader = new Reader(buf);
  const data = {};
  while (reader.pos < reader.len) {
    const { fieldNum, wireType } = reader.tag();
    switch (fieldNum) {
      case 1:
        data.mimeType = reader.string();
        break;
      case 2:
        data.data = reader.bytes().toString("base64");
        break;
      default:
        reader.skip(wireType);
    }
  }
  return data;
}

function decodePart(buf) {
  const reader = new Reader(buf);
  const part = {};
  while (reader.pos < reader.len) {
    const { fieldNum, wireType } = reader.tag();
    switch (fieldNum) {
      case 1:
        part.text = reader.string();
        break;
      case 2:
        part.inlineData = decodeInlineData(reader.bytes());
        break;
      case 10:
        part.thought = reader.bool();
        break;
      case 11:
        part.thoughtSignature = reader.bytes().toString("base64");
        break;
      default:
        reader.skip(wireType);
    }
  }
  return part;
}

function decodeContent(buf) {
  const reader = new Reader(buf);
  const content = { parts: [] };
  while (reader.pos < reader.len) {
    const { fieldNum, wireType } = reader.tag();
    switch (fieldNum) {
      case 1:
        content.role = reader.string();
        break;
      case 2:
        content.parts.push(decodePart(reader.bytes()));
        break;
      default:
        reader.skip(wireType);
    }
  }
  return content;
}

function decodeCandidate(buf) {
  const reader = new Reader(buf);
  const candidate = {};
  while (reader.pos < reader.len) {
    const { fieldNum, wireType } = reader.tag();
    switch (fieldNum) {
      case 1:
        candidate.index = reader.int32();
        break;
      case 2:
        candidate.content = decodeContent(reader.bytes());
        break;
      case 3:
        candidate.finishReason = FINISH_REASONS[reader.uint32()] || "UNKNOWN";
        break;
      case 5:
        candidate.finishMessage = reader.string();
        break;
      default:
        reader.skip(wireType);
    }
  }
  return candidate;
}

function decodeUsageMetadata(buf) {
  const reader = new Reader(buf);
  const meta = {};
  while (reader.pos < reader.len) {
    const { fieldNum, wireType } = reader.tag();
    switch (fieldNum) {
      case 1:
        meta.promptTokenCount = reader.int32();
        break;
      case 2:
        meta.candidatesTokenCount = reader.int32();
        break;
      case 3:
        meta.totalTokenCount = reader.int32();
        break;
      case 5:
        meta.cachedContentTokenCount = reader.int32();
        break;
      case 14:
        meta.thoughtsTokenCount = reader.int32();
        break;
      default:
        reader.skip(wireType);
    }
  }
  return meta;
}

function decodeMasterResponse(buf) {
  const reader = new Reader(buf);
  const resp = { candidates: [] };
  while (reader.pos < reader.len) {
    const { fieldNum, wireType } = reader.tag();
    switch (fieldNum) {
      case 2:
        resp.candidates.push(decodeCandidate(reader.bytes()));
        break;
      case 4:
        resp.usageMetadata = decodeUsageMetadata(reader.bytes());
        break;
      case 11:
        resp.modelVersion = reader.string();
        break;
      case 13:
        resp.responseId = reader.string();
        break;
      default:
        reader.skip(wireType);
    }
  }
  return resp;
}

export function decodeGenerateContentResponse(buf) {
  const reader = new Reader(buf);
  const result = {};
  while (reader.pos < reader.len) {
    const { fieldNum, wireType } = reader.tag();
    switch (fieldNum) {
      case 1:
        if (wireType === 2) result.response = decodeMasterResponse(reader.bytes());
        else reader.skip(wireType);
        break;
      case 2:
        if (wireType === 2) result.traceId = reader.string();
        else reader.skip(wireType);
        break;
      case 3:
        if (wireType === 0) result.consumedCredits = reader.uint32();
        else reader.skip(wireType);
        break;
      case 4:
        if (wireType === 0) result.remainingCredits = reader.uint32();
        else reader.skip(wireType);
        break;
      default:
        reader.skip(wireType);
    }
  }
  return result;
}

// ── Quota protobuf decoding (RetrieveUserQuotaSummary) ──

function decodeQuotaLengthDelimited(reader) {
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

function decodeQuotaVarint(reader) {
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
    const tagByte = reader.buf[reader.pos++];
    const field = tagByte >> 3;
    const wire = tagByte & 0x07;
    if (wire === 0) {
      group.quota["field" + field] = decodeQuotaVarint(reader);
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
    const valueBuffer = decodeQuotaLengthDelimited(reader);
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
          group.quota["field" + quotaField] = decodeQuotaVarint(quotaReader);
        } else if (quotaWire === 5) {
          if (quotaReader.pos + 4 > quotaReader.len) break;
          group.quota["field" + quotaField] = quotaReader.buf.readFloatLE(quotaReader.pos);
          quotaReader.pos += 4;
        } else if (quotaWire === 2) {
          decodeQuotaLengthDelimited(quotaReader);
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

export function decodeUserQuotaSummary(buf) {
  const groups = [];
  const reader = { buf, pos: 0, get len() { return buf.length; } };
  while (reader.pos < reader.len) {
    const tagByte = reader.buf[reader.pos++];
    const field = tagByte >> 3;
    const wire = tagByte & 0x07;
    if (wire === 0) {
      decodeQuotaVarint(reader);
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
    const valueBuffer = decodeQuotaLengthDelimited(reader);
    if (field === 2) {
      const gReader = { buf: valueBuffer, pos: 0, get len() { return valueBuffer.length; } };
      while (gReader.pos < gReader.len) {
        const gTag = gReader.buf[gReader.pos++];
        const gField = gTag >> 3;
        const gWire = gTag & 0x07;
        if (gWire === 0) decodeQuotaVarint(gReader);
        else if (gWire === 5) gReader.pos += 4;
        else if (gWire === 1) gReader.pos += 8;
        else if (gWire === 2) {
          const itemBuffer = decodeQuotaLengthDelimited(gReader);
          if (gField === 1) groups.push(decodeQuotaGroup(itemBuffer));
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

function groupFor(group) {
  const id = String(group.id || "");
  if (id.startsWith("gemini-")) return "gemini";
  if (id.startsWith("3p-")) return "third_party";
  return "other";
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
  };
}

export function normalizeUserQuotaSummary(payload) {
  const sourceGroups = Array.isArray(payload) ? payload : payload?.groups;
  const limits = (sourceGroups || [])
    .map(normalizeQuotaLimit)
    .filter((limit) => limit.group !== "other" || limit.id === "weekly" || limit.id === "5h");
  if (!limits.length) {
    return {
      available: false,
      remaining_percent: null,
      limits: [],
      updated_at: null,
      error: {
        code: "antigravity_quota_fields_unavailable",
        message: "Antigravity quota 响应中未包含可识别的额度分组。",
      },
    };
  }
  return {
    available: true,
    remaining_percent:
      limits.find((l) => l.group === "gemini" && l.id === "weekly")?.remaining_percent ??
      limits.find((l) => l.id === "weekly")?.remaining_percent ??
      limits[0].remaining_percent,
    limits,
    updated_at: new Date().toISOString(),
    error: null,
  };
}
