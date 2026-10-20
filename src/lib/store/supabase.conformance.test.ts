import { createClient } from "@supabase/supabase-js";
import { describe, it } from "vitest";
import { SupabaseStore } from "./supabase";
import { runStoreConformance } from "./conformance";

// Runs the shared Store suite against a real Supabase project. Skipped unless both variables are set.
//
//   SUPABASE_TEST_URL=https://<ref>.supabase.co SUPABASE_TEST_SERVICE_KEY=<service role key> npm test
//
// Use a dedicated throwaway project with supabase/migrations applied, NEVER production: the suite creates and
// deletes auth users (and, by cascade, their projects, keys and checks).
const url = process.env.SUPABASE_TEST_URL;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_KEY;

if (!url || !serviceKey) {
  describe.skip("Store conformance: SupabaseStore", () => {
    it("needs SUPABASE_TEST_URL and SUPABASE_TEST_SERVICE_KEY", () => {});
  });
} else {
  runStoreConformance("SupabaseStore", async () => {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const userIds: string[] = [];
    return {
      store: new SupabaseStore(admin),
      async newOwnerId() {
        const { data, error } = await admin.auth.admin.createUser({
          email: `conformance-${crypto.randomUUID()}@example.test`,
          email_confirm: true,
        });
        if (error) throw error;
        userIds.push(data.user.id);
        return data.user.id;
      },
      async cleanup() {
        // Deleting the user cascades to projects, api_keys and checks.
        for (const id of userIds) await admin.auth.admin.deleteUser(id);
      },
    };
  });
}
