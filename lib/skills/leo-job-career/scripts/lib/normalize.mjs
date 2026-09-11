import { parseSalary } from "./salary.mjs";

export function normalizeJobFact(rawItem, rawDetail = null) {
  const detailJob = rawDetail?.jobInfo || rawDetail?.zpData?.jobInfo || {};
  const detailBrand = rawDetail?.brandComInfo || rawDetail?.zpData?.brandComInfo || {};
  const detailBoss = rawDetail?.bossInfo || rawDetail?.zpData?.bossInfo || {};

  const encryptJobId = detailJob.encryptJobId || rawItem?.encryptJobId || "";
  const now = new Date().toISOString();

  const labels = Array.from(new Set([
    ...(detailJob.jobLabels || []),
    ...(rawItem?.jobLabels || []),
    ...(detailJob.skills || []),
    ...(rawItem?.skills || []),
  ])).filter(Boolean);

  const salaryDesc = detailJob.salaryDesc || rawItem?.salaryDesc || "";
  const salary = parseSalary(salaryDesc);

  return {
    schema_version: 1,
    source: "boss",
    source_job_id: encryptJobId,
    canonical_key: `boss:${encryptJobId}`,
    title: detailJob.jobName || rawItem?.jobName || "",
    description: detailJob.postDescription || rawItem?.postDescription || "",
    salary,
    requirements: {
      experience_raw: detailJob.experienceName || rawItem?.jobExperience || "",
      degree_raw: detailJob.degreeName || rawItem?.jobDegree || "",
      labels,
    },
    company: {
      name: detailBrand.brandName || rawItem?.brandName || "",
      industry: detailBrand.industryName || rawItem?.brandIndustry || "",
      size: detailBrand.scaleName || rawItem?.brandScaleName || "",
      financing_stage: detailBrand.stageName || rawItem?.brandStageName || "",
      introduction: detailBrand.introduce || "",
    },
    location: {
      city: detailJob.cityName || rawItem?.cityName || "北京",
      district: detailJob.areaDistrict || rawItem?.areaDistrict || "",
      business_district: detailJob.businessDistrict || rawItem?.businessDistrict || "",
      address: detailJob.address || "",
      longitude: detailJob.longitude !== undefined ? Number(detailJob.longitude) : null,
      latitude: detailJob.latitude !== undefined ? Number(detailJob.latitude) : null,
    },
    recruiter: {
      name: detailBoss.name || rawItem?.bossName || "",
      title: detailBoss.title || rawItem?.bossTitle || "",
      activity_raw: detailBoss.activeTimeDesc || rawItem?.activeTimeDesc || "",
    },
    access: {
      security_id: rawItem?.securityId || rawDetail?.securityId || "",
      lid: rawItem?.lid || rawDetail?.lid || "",
      captured_at: now,
    },
    observations: {
      first_seen_at: now,
      last_seen_at: now,
      last_verified_at: now,
      status: "active",
    },
  };
}
