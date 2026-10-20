import { describe, expect, it } from "vitest";
import { MemoryStore } from "./memory";
import { runStoreConformance } from "./conformance";

runStoreConformance("MemoryStore", async () => ({
  store: new MemoryStore(),
  newOwnerId: async () => crypto.randomUUID(),
}));

describe("MemoryStore limits", () => {
  it("clamps listChecks limit to 1000", async () => {
    const store = new MemoryStore();
    const p = await store.createProject("owner", "App");
    const base = Date.now();
    for (let i = 0; i < 1001; i++) {
      await store.insertCheck({
        id: crypto.randomUUID(), project_id: p.id, created_at: new Date(base - i).toISOString(), email: "a@x.com",
        normalized_email: "a@x.com", email_domain: "x.com", ip: null, user_agent: null, device_id: null,
        decision: "allow", score: 0, reason: "", signals: [], latency_ms: 1,
      });
    }
    expect(await store.listChecks(p.id, { limit: 5000 })).toHaveLength(1000);
    expect(await store.listChecks(p.id)).toHaveLength(50);
  });
});
