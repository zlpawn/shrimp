/**
 * One entry per APIMart video *submit* endpoint. The CLI, payload building, dry-run,
 * idempotency, polling and saving are shared, so a new endpoint is just a new entry here
 * (plus a row in SKILL.md).
 *
 *   path(args)     -> endpoint path under api_url
 *   positional     -> name of the required positional arg after the command (e.g. remix <task_id>)
 *   requireModel   -> true when config.default_model must not be used (model must match something)
 */
export const OPERATIONS = {
  generate: {
    summary: "文生 / 图生 / 参考生成视频（所有视频模型，含 MiniMax-H3-Context-IR 提示词增强）",
    path: () => "/videos/generations",
  },
  remix: {
    summary: "VEO3.1 续写已完成的视频（8s → 15s），model 必须与原任务一致",
    path: ({ taskId }) => `/videos/${encodeURIComponent(taskId)}/remix`,
    positional: "taskId",
    requireModel: true,
  },
};

// Flags map 1:1 onto request fields; models disagree on names (size vs aspect_ratio),
// so SKILL.md tells the agent which one each model reads. --set always wins.
export function buildPayload(args, model, imageUrls = []) {
  const payload = { model };
  if (args.prompt) payload.prompt = args.prompt;
  if (args.size) payload.size = args.size;
  if (args.aspectRatio) payload.aspect_ratio = args.aspectRatio;
  if (Number.isFinite(args.duration)) payload.duration = args.duration;
  if (args.resolution) payload.resolution = args.resolution;
  if (imageUrls.length > 0) payload.image_urls = imageUrls;
  return { ...payload, ...args.set };
}
