export function evaluateFreshness(job, customObservations = null) {
  const obs = customObservations || job.observations || {};
  const recruiter = job.recruiter || {};
  const activity = (recruiter.activity_raw || "").trim();

  const evidence = [];
  let grade = "C";
  let confidence = 0.7;

  if (obs.status === "inactive") {
    return {
      grade: "E",
      confidence: 0.95,
      evidence: ["岗位已下线或标记为无效"],
    };
  }

  if (/刚刚|今日|在线/.test(activity)) {
    grade = "A";
    confidence = 0.9;
    evidence.push(`招聘者${activity}`);
  } else if (/3日内|本周/.test(activity)) {
    grade = "B";
    confidence = 0.85;
    evidence.push(`招聘者${activity}`);
  } else if (/2周内|半月/.test(activity)) {
    grade = "C";
    confidence = 0.75;
    evidence.push(`招聘者${activity}`);
  } else if (/月内|月前/.test(activity)) {
    grade = "D";
    confidence = 0.65;
    evidence.push(`招聘者活跃度较低（${activity}）`);
  } else if (/年|长期/.test(activity)) {
    grade = "E";
    confidence = 0.85;
    evidence.push(`招聘者长期未活跃（${activity}）`);
  } else {
    evidence.push("招聘者活跃时间未明确展示，依赖当前搜索曝光状态");
  }

  return { grade, confidence, evidence };
}

export function detectDeterministicExclusions(job) {
  const reasons = [];
  const text = `${job.title || ""} ${job.description || ""} ${job.requirements?.labels?.join(" ") || ""}`;
  const companyName = job.company?.name || "";
  const industry = job.company?.industry || "";

  const outsourcingPatterns = [
    { pattern: /驻场开发|外派驻场|客户现场办公|驻场办公/, reason: "包含明确驻场/客户现场办公特征" },
    { pattern: /人力外包|人力派遣|劳务派遣|外包岗位|介意外包勿投/, reason: "包含明确人力外包或劳务派遣描述" },
    { pattern: /派驻某互联网|派驻客户|派驻大厂/, reason: "包含客户派驻项目特征" },
  ];

  for (const { pattern, reason } of outsourcingPatterns) {
    if (pattern.test(text)) {
      reasons.push(reason);
    }
  }

  if (/人力资源服务|劳务派遣/.test(industry)) {
    reasons.push(`所属行业为人力资源服务（${industry}）`);
  }
  if (/人力资源|外包服务|劳务/.test(companyName)) {
    reasons.push(`公司名称包含人力服务/外包特征（${companyName}）`);
  }

  return {
    excluded: reasons.length > 0,
    reasons,
  };
}

export function evaluateJavaRelevance(job) {
  const rawText = `${job.title || ""} ${job.description || ""} ${job.requirements?.labels?.join(" ") || ""}`.toLowerCase();
  // Strip out negative mentions like "无Java要求"
  const cleanedText = rawText.replace(/无java[^s，。；]*|不需要java[^s，。；]*|不限java[^s，。；]*/gi, "");

  const hasJava = /java|spring|jvm|mybatis/.test(cleanedText);
  const hasPython = /python|pytorch|tensorflow|transformers/.test(cleanedText);

  if (hasPython && !hasJava) {
    return {
      level: "python_only",
      confidence: 0.95,
      evidence: ["仅要求Python/深度学习栈，无Java技术要求"],
    };
  }

  if (hasJava) {
    const javaInTitle = /java/.test((job.title || "").toLowerCase());
    const javaInLabels = (job.requirements?.labels || []).some(l => /java/i.test(l));

    if (javaInTitle || javaInLabels) {
      return {
        level: "primary",
        confidence: 0.95,
        evidence: ["Java为核心职位名称或硬性技能标签"],
      };
    }

    return {
      level: "accepted",
      confidence: 0.85,
      evidence: ["岗位JD中明确要求Java/Spring相关技术"],
    };
  }

  return {
    level: "minor",
    confidence: 0.7,
    evidence: ["未发现明确的Java技术栈要求"],
  };
}

export function evaluateAgentRelevance(job) {
  const title = (job.title || "").toLowerCase();
  const desc = (job.description || "").toLowerCase();
  const labels = (job.requirements?.labels || []).map(l => l.toLowerCase());

  const coreAgentTerms = ["agent", "智能体", "rag", "mcp", "function calling", "知识库", "工作流编排", "大模型应用", "多智能体", "langchain", "dify"];
  const generalAiTerms = ["大模型", "ai", "llm", "人工智能", "chatgpt"];

  const matchedCoreInTitle = coreAgentTerms.filter(t => title.includes(t));
  const matchedCoreInDesc = coreAgentTerms.filter(t => desc.includes(t));
  const matchedCoreInLabels = labels.filter(l => coreAgentTerms.some(t => l.includes(t)));

  if (matchedCoreInTitle.length > 0 || (matchedCoreInDesc.length >= 2 && matchedCoreInLabels.length > 0)) {
    return {
      level: "core",
      confidence: 0.9,
      evidence: [`核心业务明确涉及Agent/智能体生态（匹配项：${matchedCoreInDesc.concat(matchedCoreInTitle).join(", ")}）`],
    };
  }

  if (matchedCoreInDesc.length >= 1) {
    return {
      level: "supporting",
      confidence: 0.8,
      evidence: [`包含部分Agent相关研发职责（${matchedCoreInDesc.join(", ")}）`],
    };
  }

  const hasGeneralAi = generalAiTerms.some(t => desc.includes(t) || title.includes(t));
  if (hasGeneralAi) {
    if (/优先|加分项|了解|感兴趣|接触过/.test(desc)) {
      return {
        level: "keyword_only",
        confidence: 0.85,
        evidence: ["AI/大模型仅作为加分项或泛泛关注，日常研发主体仍为常规业务"],
      };
    }
    return {
      level: "supporting",
      confidence: 0.75,
      evidence: ["包含通用大模型/AI应用关键词"],
    };
  }

  return {
    level: "none",
    confidence: 0.9,
    evidence: ["未包含任何Agent或大模型实质研发内容"],
  };
}
