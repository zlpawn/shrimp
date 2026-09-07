import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BaseJobAdapter } from "../../lib/scheduler/adapters/base-adapter.mjs";
import { JobRegistry } from "../../lib/scheduler/registry.mjs";

class DummyAdapter extends BaseJobAdapter {
  constructor(opts) {
    super(opts);
    this.configChanges = [];
  }

  getStatus(config) {
    return {
      ...super.getStatus(config),
      scheduleSummary: `每 ${config.interval || 10} 秒`,
    };
  }

  getSchema() {
    return [
      { key: "enabled", label: "启用", type: "boolean" },
      { key: "interval", label: "间隔", type: "number" },
    ];
  }

  async runNow() {
    return { ok: true, message: "Dummy success" };
  }

  async onConfigChange(patch, full) {
    this.configChanges.push({ patch, full });
  }
}

describe("JobRegistry", () => {
  it("registers and lists jobs with schema and status", () => {
    const mockStore = {
      getJobConfig: (id) => ({ enabled: true, interval: 15 }),
      updateJobConfig: (id, patch) => ({ enabled: true, interval: patch.interval || 15 }),
    };

    const registry = new JobRegistry({ configStore: mockStore });
    const adapter = new DummyAdapter({
      id: "dummy_job",
      name: "测试任务",
      module: "测试模块",
      description: "这是一个测试任务",
    });

    registry.register(adapter);

    const list = registry.listJobs();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "dummy_job");
    assert.equal(list[0].name, "测试任务");
    assert.equal(list[0].status, "idle");
    assert.equal(list[0].config.interval, 15);
    assert.equal(list[0].schema.length, 2);
  });

  it("runs a job and records execution history", async () => {
    const mockStore = {
      getJobConfig: () => ({ enabled: true }),
    };
    const registry = new JobRegistry({ configStore: mockStore });
    const adapter = new DummyAdapter({ id: "dummy_job", name: "测试任务" });
    registry.register(adapter);

    const res = await registry.runJob("dummy_job");
    assert.equal(res.ok, true);
    assert.equal(res.message, "Dummy success");
    assert.ok(res.durationMs >= 0);

    const list = registry.listJobs();
    assert.equal(list[0].lastMessage, "Dummy success");
    assert.equal(list[0].recentRuns.length, 1);
    assert.equal(list[0].recentRuns[0].success, true);
  });

  it("prevents overlapping concurrent runs of the same job", async () => {
    const mockStore = { getJobConfig: () => ({ enabled: true }) };
    const registry = new JobRegistry({ configStore: mockStore });

    class SlowAdapter extends BaseJobAdapter {
      async runNow() {
        await new Promise((r) => setTimeout(r, 50));
        return { ok: true };
      }
    }

    registry.register(new SlowAdapter({ id: "slow_job", name: "慢任务" }));

    const p1 = registry.runJob("slow_job");
    const p2 = registry.runJob("slow_job");

    const [res1, res2] = await Promise.all([p1, p2]);
    assert.equal(res1.ok, true);
    assert.equal(res2.ok, false);
    assert.match(res2.error, /正在运行中/);
  });

  it("updates job config and notifies adapter", async () => {
    let savedConfig = { enabled: true, interval: 10 };
    const mockStore = {
      getJobConfig: () => savedConfig,
      updateJobConfig: (id, patch) => {
        savedConfig = { ...savedConfig, ...patch };
        return savedConfig;
      },
    };

    const registry = new JobRegistry({ configStore: mockStore });
    const adapter = new DummyAdapter({ id: "dummy_job" });
    registry.register(adapter);

    const updated = await registry.updateJobConfig("dummy_job", { interval: 60 });
    assert.equal(updated.config.interval, 60);
    assert.equal(adapter.configChanges.length, 1);
    assert.equal(adapter.configChanges[0].patch.interval, 60);
  });
});
