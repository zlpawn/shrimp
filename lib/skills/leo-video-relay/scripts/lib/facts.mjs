import fs from "node:fs";
import path from "node:path";
import { fmtTime, readJson, writeJson } from "./store.mjs";

const KINDS = new Set(["speech", "visual", "on_screen_text", "metadata"]);
const EVIDENCE_SLOP = 3; // seconds a fact may sit away from its evidence (ASR timing is approximate)

function loadEvidence(runDir, audit) {
  const speech = new Map();
  for (const s of readJson(path.join(runDir, "transcript.json"), { segments: [] }).segments) speech.set(s.id, s);
  for (const track of audit.subtitles || []) {
    for (const s of readJson(path.join(runDir, "subtitles", `${track.track}.json`)).segments) speech.set(s.id, s);
  }
  return { speech, frames: new Map((audit.frames || []).map((f) => [f.id, f])) };
}

export function computeStatus(audit) {
  const hasSubtitles = (audit.subtitles || []).length > 0;
  const audioOk = audit.audio?.status === "ok" || audit.audio?.status === "no_speech";
  const audioFailed = audit.audio?.status === "failed";
  const heardSomething = audit.audio?.status === "ok" || hasSubtitles;
  const visualOk = audit.visual?.status === "complete";

  if (!visualOk && !heardSomething) return { status: "failed", status_reasons: ["画面未审，也没有转写或字幕，无法形成事实"] };
  const reasons = [];
  if (!visualOk) reasons.push(`画面未审：${audit.visual?.reason || "agent 无法读取图片"}`);
  if (audioFailed) reasons.push(hasSubtitles ? "转写失败，语音事实只来自字幕" : "转写失败且无字幕，语音内容未理解");
  return { status: visualOk && audioOk ? "complete" : "partial", status_reasons: reasons };
}

function checkRange(item, duration, label, errors) {
  if (typeof item.start !== "number" || typeof item.end !== "number" || item.start > item.end) {
    errors.push(`${label}：start/end 必须是秒数且 start ≤ end`);
    return false;
  }
  if (item.start < -EVIDENCE_SLOP || item.end > duration + EVIDENCE_SLOP) {
    errors.push(`${label}：时间超出视频时长 ${duration.toFixed(1)} 秒`);
    return false;
  }
  return true;
}

function checkFact(fact, ctx, seen, errors) {
  const label = fact.id || "(无 id 的事实)";
  if (!/^FACT-\d+$/.test(fact.id || "")) errors.push(`${label}：id 须形如 FACT-0001`);
  if (seen.has(fact.id)) errors.push(`${label}：id 重复`);
  seen.add(fact.id);
  if (!KINDS.has(fact.kind)) errors.push(`${label}：kind 须是 ${[...KINDS].join(" / ")}`);
  if (!String(fact.text || "").trim()) errors.push(`${label}：text 为空`);
  const inRange = checkRange(fact, ctx.duration, label, errors);
  if (fact.kind === "metadata") return;

  const evidence = Array.isArray(fact.evidence) ? fact.evidence : [];
  if (!evidence.length) errors.push(`${label}：缺少 evidence`);
  let hasSpeech = false;
  let hasFrame = false;
  for (const id of evidence) {
    const frame = ctx.evidence.frames.get(id);
    const segment = ctx.evidence.speech.get(id);
    if (!frame && !segment) { errors.push(`${label}：证据 ${id} 不存在`); continue; }
    if (frame) {
      hasFrame = true;
      if (frame.review !== "detail") errors.push(`${label}：${id} 只有 ${frame.review} 级别，单独读过并用 review --detail 登记后才能作证据`);
      if (inRange && (frame.t < fact.start - EVIDENCE_SLOP || frame.t > fact.end + EVIDENCE_SLOP)) errors.push(`${label}：${id} 的时间 ${fmtTime(frame.t)} 不在事实的时间范围内`);
    } else {
      hasSpeech = true;
      if (inRange && (segment.end < fact.start - EVIDENCE_SLOP || segment.start > fact.end + EVIDENCE_SLOP)) errors.push(`${label}：${id} 的时间 ${fmtTime(segment.start)} 不在事实的时间范围内`);
    }
  }
  if (fact.kind === "speech" && evidence.length && !hasSpeech) errors.push(`${label}：speech 事实须引用 ASR 或 SUB 证据`);
  if ((fact.kind === "visual" || fact.kind === "on_screen_text") && evidence.length && !hasFrame) errors.push(`${label}：${fact.kind} 事实须引用 FRAME 证据`);
}

function checkSections(draft, ctx, factIds, errors) {
  const sections = Array.isArray(draft.sections) ? draft.sections : [];
  if (!sections.length) { errors.push("sections 为空：需要按时间顺序覆盖整个视频"); return; }
  const allowed = Math.max(5, ctx.duration * 0.01);
  let cursor = 0;
  sections.forEach((section, i) => {
    const label = `sections[${i}]`;
    if (!checkRange(section, ctx.duration, label, errors)) return;
    if (!String(section.title || "").trim()) errors.push(`${label}：缺少 title`);
    if (section.start - cursor > allowed) errors.push(`${fmtTime(cursor)}-${fmtTime(section.start)} 没有被任何 section 覆盖`);
    cursor = Math.max(cursor, section.end);
    const ids = Array.isArray(section.fact_ids) ? section.fact_ids : [];
    for (const id of ids) if (!factIds.has(id)) errors.push(`${label}：fact_ids 引用了不存在的 ${id}`);
    if (!ids.length && ctx.visualOk) errors.push(`${label}：没有引用任何事实`);
  });
  if (ctx.duration - cursor > allowed) errors.push(`${fmtTime(cursor)}-${fmtTime(ctx.duration)} 没有被任何 section 覆盖`);
}

export function validateDraft(draft, audit, evidence) {
  const errors = [];
  const duration = audit.duration;
  if (!String(draft.type || "").trim()) errors.push("缺少 type（视频类型）");
  if (!String(draft.topic || "").trim()) errors.push("缺少 topic（用作输出目录名）");
  const facts = Array.isArray(draft.facts) ? draft.facts : [];
  const ctx = { duration, evidence, visualOk: audit.visual?.status === "complete" };
  const seen = new Set();
  for (const fact of facts) checkFact(fact, ctx, seen, errors);
  checkSections(draft, ctx, seen, errors);

  for (const [i, item] of (draft.unconfirmed || []).entries()) {
    if (!String(item.description || "").trim()) errors.push(`unconfirmed[${i}]：缺少 description`);
    checkRange(item, duration, `unconfirmed[${i}]`, errors);
  }

  if (audit.visual?.status !== "blocked") {
    const pending = (audit.frames || []).filter((f) => f.review === "none");
    if (pending.length) errors.push(`还有 ${pending.length} 帧未审（首个 ${pending[0].id}）：继续 review，或确实看不了图时用 review --blocked`);
  }
  const times = audit.candidate_times || [];
  const limit = audit.frame_config?.max_interval;
  if (limit) {
    for (let i = 1; i < times.length; i += 1) {
      if (times[i] - times[i - 1] > limit * 2) { errors.push(`抽帧在 ${fmtTime(times[i - 1])}-${fmtTime(times[i])} 有缺口`); break; }
    }
  }
  return errors;
}

export function renderFactsMd(pack) {
  const { video } = pack;
  const byId = new Map(pack.facts.map((f) => [f.id, f]));
  const lines = [`# ${pack.topic}`, ""];
  if (video.title) lines.push(`- 标题：${video.title}`);
  if (video.author) lines.push(`- 作者：${video.author}`);
  lines.push(`- 来源：${video.url || video.local_path}`, `- 类型：${pack.type}`, `- 时长：${fmtTime(video.duration)}`, `- 状态：${pack.status}`);
  for (const reason of pack.status_reasons) lines.push(`- 限制：${reason}`);
  lines.push("");
  for (const section of pack.sections) {
    lines.push(`## [${fmtTime(section.start)} - ${fmtTime(section.end)}] ${section.title}`, "");
    if (section.summary) lines.push(section.summary, "");
    for (const id of section.fact_ids || []) {
      const f = byId.get(id);
      lines.push(`- ${f.id} [${fmtTime(f.start)}] ${f.text}${f.evidence?.length ? `（${f.evidence.join(", ")}）` : ""}`);
    }
    lines.push("");
  }
  if (pack.unconfirmed?.length) {
    lines.push("## 未确认", "");
    for (const u of pack.unconfirmed) lines.push(`- [${fmtTime(u.start)}] ${u.description}${u.evidence?.length ? `（${u.evidence.join(", ")}）` : ""}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Validates the agent's draft and, when clean, writes facts.json and facts.md with a script-computed status. */
export function runCheck(runDir, video) {
  const auditFile = path.join(runDir, "audit.json");
  if (!fs.existsSync(auditFile)) return { ok: false, errors: ["还没有 audit.json，请先运行 prepare"] };
  const draftFile = path.join(runDir, "facts.draft.json");
  if (!fs.existsSync(draftFile)) return { ok: false, errors: ["还没有 facts.draft.json，结构见 references/facts-schema.md"] };
  const audit = readJson(auditFile);
  const draft = readJson(draftFile);
  const errors = validateDraft(draft, audit, loadEvidence(runDir, audit));
  if (errors.length) return { ok: false, errors };

  const pack = {
    schema_version: 1,
    video,
    type: draft.type.trim(),
    topic: draft.topic.trim(),
    ...computeStatus(audit),
    sections: draft.sections,
    facts: draft.facts,
    unconfirmed: draft.unconfirmed || [],
  };
  writeJson(path.join(runDir, "facts.json"), pack);
  fs.writeFileSync(path.join(runDir, "facts.md"), renderFactsMd(pack), "utf8");
  return { ok: true, pack };
}
