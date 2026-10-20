import Link from "next/link";
import { Search } from "lucide-react";
import { AppContent } from "@/components/ui/app-window";
import { Button, Input, PageTitle, Panel, Segmented, buttonClass } from "@/components/ui";
import { ChecksTable } from "@/components/dashboard/checks-table";
import { parseBefore } from "@/components/dashboard/helpers";
import { getCurrentProject } from "@/lib/session";
import { getStore } from "@/lib/store";
import type { Decision } from "@/lib/types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
type Filter = "all" | Decision;
const FILTERS: Filter[] = ["all", "allow", "challenge", "block"];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ChecksPage({
  searchParams,
}: {
  searchParams: Promise<{ decision?: string; q?: string; search?: string; before?: string }>;
}) {
  const sp = await searchParams;
  const filter: Filter = FILTERS.includes(one(sp.decision) as Filter) ? (one(sp.decision) as Filter) : "all";
  const q = (one(sp.q) || one(sp.search)).trim().slice(0, 100);
  const beforeRaw = one(sp.before);
  const before = parseBefore(beforeRaw);

  const project = await getCurrentProject();
  const rows = await getStore().listChecks(project.id, {
    limit: PAGE_SIZE + 1,
    before,
    decision: filter === "all" ? undefined : filter,
    search: q || undefined,
  });
  const hasMore = rows.length > PAGE_SIZE;
  const checks = rows.slice(0, PAGE_SIZE);

  const href = (over: { decision?: Filter; before?: string; noSearch?: boolean }) => {
    const p = new URLSearchParams();
    const d = over.decision ?? filter;
    if (d !== "all") p.set("decision", d);
    if (q && !over.noSearch) p.set("q", q);
    if (over.before) p.set("before", over.before);
    const s = p.toString();
    return `/dashboard/checks${s ? `?${s}` : ""}`;
  };

  return (
    <AppContent>
      <PageTitle
        sub="Every signup gatekeep has scored, newest first."
        right={
          <Segmented
            value={filter}
            items={FILTERS.map((f) => ({ value: f, label: f === "all" ? "All" : f[0].toUpperCase() + f.slice(1), href: href({ decision: f }) }))}
          />
        }
      >
        Checks
      </PageTitle>

      <Panel>
        <form action="/dashboard/checks" className="flex items-center gap-2 border-b border-line p-3">
          {filter !== "all" && <input type="hidden" name="decision" value={filter} />}
          <div className="relative min-w-0 flex-1">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <Input name="q" defaultValue={q} placeholder="Search email or IP" className="pl-8" />
          </div>
          <Button type="submit">Search</Button>
          {q && (
            <Link href={href({ noSearch: true })} className={buttonClass("ghost")}>
              Clear
            </Link>
          )}
        </form>

        {checks.length === 0 ? (
          <div className="px-4 py-14 text-center">
            <p className="text-[14px] text-ink">{q || filter !== "all" || before ? "No checks match." : "No checks yet."}</p>
            <p className="mt-1 text-[12px] text-muted">
              {q || filter !== "all" || before
                ? "Try a different filter or search."
                : "Send a request to /api/v1/check and it will show up here."}
            </p>
          </div>
        ) : (
          <ChecksTable checks={checks} />
        )}

        {(hasMore || before) && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-[12px] text-muted">
            <span>{before ? <Link href={href({})} className="hover:text-ink">← Newest</Link> : ""}</span>
            {hasMore && (
              <Link href={href({ before: checks[checks.length - 1].created_at })} className="hover:text-ink">
                Older →
              </Link>
            )}
          </div>
        )}
      </Panel>
    </AppContent>
  );
}
