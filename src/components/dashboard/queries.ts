// Server-side aggregate helpers built on the Store contract.
import type { Store } from "@/lib/store/types";

const PAGE = 500;
export const AVG_SCORE_CAP = 5000;

/** Start of the UTC day `range` days back, inclusive of today (matches Store.dailyStats buckets). */
export function rangeStartIso(range: number, now = Date.now()): string {
  const dayMs = 86_400_000;
  return new Date(Math.floor(now / dayMs) * dayMs - (range - 1) * dayMs).toISOString();
}

/**
 * Average score of checks since `sinceIso`, paging newest to oldest through listChecks.
 * Stops at `cap` rows; `truncated` is true when the cap cut the range short.
 */
export async function averageScoreSince(
  store: Pick<Store, "listChecks">,
  projectId: string,
  sinceIso: string,
  cap = AVG_SCORE_CAP,
): Promise<{ avg: number | null; count: number; truncated: boolean }> {
  let sum = 0;
  let count = 0;
  let before: string | undefined;
  while (count < cap) {
    const limit = Math.min(PAGE, cap - count);
    const rows = await store.listChecks(projectId, { limit, before });
    for (const r of rows) {
      if (r.created_at < sinceIso) return { avg: count ? Math.round(sum / count) : null, count, truncated: false };
      sum += r.score;
      count++;
    }
    if (rows.length < limit) return { avg: count ? Math.round(sum / count) : null, count, truncated: false };
    before = rows[rows.length - 1].created_at;
  }
  return { avg: count ? Math.round(sum / count) : null, count, truncated: true };
}
