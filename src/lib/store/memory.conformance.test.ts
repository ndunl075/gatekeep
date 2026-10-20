import { MemoryStore } from "./memory";
import { runStoreConformance } from "./conformance";

runStoreConformance("MemoryStore", async () => ({
  store: new MemoryStore(),
  newOwnerId: async () => crypto.randomUUID(),
}));
