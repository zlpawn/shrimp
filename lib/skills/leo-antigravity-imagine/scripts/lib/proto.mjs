// Zero-dependency Protobuf codec for Antigravity v1internal GenerateContent.
// Supports responseModalities=IMAGE (field 21) and ImageConfig (field 30:
// aspect_ratio=field 2, image_size=field 4) in aiplatform.master.GenerationConfig.

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

// google.cloud.aiplatform.master.ImageConfig:
//   1: image_output_options (msg: 1=mime_type, 2=compression_quality)
//   2: aspect_ratio (string, e.g. "16:9", "9:16", "1:1")
//   4: image_size   (string, e.g. "1K", "2K", "4K")
function encodeImageOutputOptions(io) {
  const f = [];
  if (io.mimeType) f.push(encStr(1, io.mimeType));
  if (io.compressionQuality != null) f.push(encVarintField(2, io.compressionQuality));
  return concatBufs(f);
}

function encodeImageConfig(ic) {
  const f = [];
  if (ic.imageOutputOptions) {
    const ioBuf = encodeImageOutputOptions(ic.imageOutputOptions);
    if (ioBuf.length > 0) f.push(encMsg(1, ioBuf));
  }
  if (ic.aspectRatio && ic.aspectRatio !== "auto") {
    f.push(encStr(2, ic.aspectRatio));
  }
  if (ic.imageSize) {
    f.push(encStr(4, ic.imageSize));
  }
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
  if (gc.imageConfig) {
    const imgBuf = encodeImageConfig(gc.imageConfig);
    if (imgBuf.length > 0) f.push(encMsg(30, imgBuf));
  }
  return concatBufs(f);
}

function encodeMasterRequest(req) {
  const f = [];
  if (req.endpoint) f.push(encStr(1, req.endpoint));
  if (Array.isArray(req.contents)) {
    for (const c of req.contents) f.push(encMsg(2, encodeContent(c)));
  }
  if (req.generationConfig) f.push(encMsg(4, encodeGenerationConfig(req.generationConfig)));
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
  if (resp.modelVersion) f.push(encStr(11, resp.modelVersion));
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

function decodeMasterResponse(buf) {
  const reader = new Reader(buf);
  const resp = { candidates: [] };
  while (reader.pos < reader.len) {
    const { fieldNum, wireType } = reader.tag();
    switch (fieldNum) {
      case 2:
        resp.candidates.push(decodeCandidate(reader.bytes()));
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
