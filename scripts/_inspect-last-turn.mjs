import {
  createLanguageServerConnectClient,
  discoverLanguageServerConnectEndpoint,
  summarizeTrajectoryDetail,
} from "../lib/remote-session/index.mjs";

const d = await discoverLanguageServerConnectEndpoint();
const c = createLanguageServerConnectClient({ baseUrl: d.baseUrl, csrfToken: d.csrfToken });
const id = "76c3fea3-495a-4cb1-94d6-f2c4d3cd2d51";
for (let i = 0; i < 12; i++) {
  const raw = await c.getCascadeTrajectory(id);
  const steps = raw.trajectory?.steps || [];
  const last = steps[steps.length - 1];
  console.log(
    "poll",
    i,
    raw.status,
    steps.map((s) => s.type),
    "lastKeys",
    last ? Object.keys(last) : null,
  );
  if (last?.plannerResponse) {
    console.log("plannerResponse keys", Object.keys(last.plannerResponse));
    console.log(
      "planner text",
      String(
        last.plannerResponse.modifiedResponse ||
          last.plannerResponse.response ||
          last.plannerResponse.text ||
          "",
      ).slice(0, 200),
    );
    console.log("planner raw slice", JSON.stringify(last.plannerResponse).slice(0, 500));
  }
  if (String(raw.status || "").includes("IDLE")) {
    const detail = summarizeTrajectoryDetail(raw, { cascadeId: id });
    console.log(
      "summary",
      detail.events.map((e) => ({ type: e.type, text: String(e.text || "").slice(0, 120) })),
    );
    break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
