import {
  createLanguageServerConnectClient,
  discoverLanguageServerConnectEndpoint,
  summarizeTrajectoryDetail,
  summarizeTrajectoryList,
  createLocalHostBackend,
} from "../lib/remote-session/index.mjs";

const discovered = await discoverLanguageServerConnectEndpoint();
console.log("discover", {
  ok: discovered.ok,
  reason: discovered.reason,
  baseUrl: discovered.baseUrl,
  csrf: discovered.csrfToken ? discovered.csrfToken.slice(0, 8) + "..." : "",
});

const client = createLanguageServerConnectClient({
  baseUrl: discovered.baseUrl,
  csrfToken: discovered.csrfToken,
});
const listed = summarizeTrajectoryList(await client.getAllCascadeTrajectories());
console.log(
  "live list",
  listed.slice(0, 3).map((x) => ({
    id: x.id,
    title: x.title,
    status: x.status,
    stepCount: x.stepCount,
  })),
);

const target = listed.find((x) => x.id.startsWith("21335b56")) || listed[0];
if (target) {
  const raw = await client.getCascadeTrajectory(target.id);
  console.log("raw keys", Object.keys(raw));
  console.log("trajectory keys", Object.keys(raw.trajectory || {}));
  console.log(
    "first step keys",
    raw.trajectory?.steps?.[0] ? Object.keys(raw.trajectory.steps[0]) : null,
  );
  console.log("first step sample", JSON.stringify(raw.trajectory?.steps?.[0] || null, null, 2).slice(0, 1200));
  console.log("second step sample", JSON.stringify(raw.trajectory?.steps?.[1] || null, null, 2).slice(0, 800));
  console.log("third step sample", JSON.stringify(raw.trajectory?.steps?.[2] || null, null, 2).slice(0, 1200));
  const detail = summarizeTrajectoryDetail(raw, { cascadeId: target.id });
  console.log("detail", {
    mode: detail.mode,
    status: detail.status,
    eventCount: detail.eventCount,
    events: detail.events.map((e) => ({
      type: e.type,
      hostType: e.hostType,
      text: String(e.text || "").slice(0, 100),
    })),
  });
}

const host = createLocalHostBackend({ logger: { warn: (...a) => console.warn(...a), log: () => {} } });
const attached = await host.attach();
console.log("attach", {
  transport: attached.transport,
  support: attached.support,
  connect: attached.connect,
});
const convs = await host.listConversations({ limit: 3 });
console.log(
  "host list",
  convs.map((c) => ({ id: c.id, title: c.title, source: c.source })),
);
if (convs[0]) {
  const snap = await host.getConversation(convs[0].id);
  console.log("host inspect", {
    mode: snap.mode,
    status: snap.status,
    eventCount: snap.eventCount,
    first: snap.events?.[0] && {
      type: snap.events[0].type,
      text: String(snap.events[0].text || "").slice(0, 80),
    },
  });
}
