export function computeCanonicalKey(job) {
  const id = job.source_job_id || job.encryptJobId || job.canonical_key?.replace(/^boss:/, "") || "";
  return `boss:${id}`;
}

function tokenize(text) {
  if (!text || typeof text !== "string") return new Set();
  const cleaned = text.toLowerCase().replace(/[\s\p{P}]+/gu, "");
  const bigrams = new Set();
  for (let i = 0; i < cleaned.length - 1; i++) {
    bigrams.add(cleaned.slice(i, i + 2));
  }
  return bigrams;
}

export function computeTextSimilarity(t1, t2) {
  const s1 = tokenize(t1);
  const s2 = tokenize(t2);
  if (s1.size === 0 && s2.size === 0) return 1.0;
  if (s1.size === 0 || s2.size === 0) return 0.0;

  let intersection = 0;
  for (const item of s1) {
    if (s2.has(item)) intersection++;
  }
  const union = s1.size + s2.size - intersection;
  return union === 0 ? 1.0 : intersection / union;
}

export function groupSemanticReposts(jobs) {
  const uniqueJobs = [];
  const repostGroups = new Map(); // representativeCanonicalKey -> JobFact[]

  // Bucket jobs by normalized company name
  const companyBuckets = new Map();
  for (const job of jobs) {
    const compName = (job.company?.name || "").trim().toLowerCase();
    if (!companyBuckets.has(compName)) {
      companyBuckets.set(compName, []);
    }
    companyBuckets.get(compName).push(job);
  }

  for (const [compName, compJobs] of companyBuckets.entries()) {
    if (!compName || compJobs.length === 1) {
      for (const j of compJobs) {
        uniqueJobs.push(j);
      }
      continue;
    }

    const assigned = new Set();

    for (let i = 0; i < compJobs.length; i++) {
      if (assigned.has(i)) continue;

      const current = compJobs[i];
      const cluster = [current];
      assigned.add(i);

      for (let j = i + 1; j < compJobs.length; j++) {
        if (assigned.has(j)) continue;
        const candidate = compJobs[j];

        const titleSim = computeTextSimilarity(current.title, candidate.title);
        const descSim = computeTextSimilarity(current.description, candidate.description);

        // High similarity in title (>0.6) and description (>0.6) or very high desc (>0.75)
        if ((titleSim >= 0.5 && descSim >= 0.6) || descSim >= 0.75) {
          cluster.push(candidate);
          assigned.add(j);
        }
      }

      // Sort cluster by observation freshness (latest last_seen_at first)
      cluster.sort((a, b) => {
        const ta = new Date(a.observations?.last_seen_at || 0).getTime();
        const tb = new Date(b.observations?.last_seen_at || 0).getTime();
        return tb - ta;
      });

      const representative = cluster[0];
      uniqueJobs.push(representative);

      if (cluster.length > 1) {
        repostGroups.set(representative.canonical_key, cluster);
      }
    }
  }

  return { uniqueJobs, repostGroups };
}
