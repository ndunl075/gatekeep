import { getSnippets } from "@/lib/snippets";
import { env } from "@/lib/env";

export const metadata = { title: "Integrations | gatekeep docs" };

export default function IntegrationsDocs() {
  const snippets = getSnippets(env.appUrl);
  return (
    <main className="mx-auto w-full max-w-[760px] px-4 py-12 text-ink-2">
      <h1 className="text-[32px] font-light tracking-tight text-ink">Integrations</h1>
      <p className="mt-2 text-[14px] text-muted">
        Drop gatekeep into Clerk, Supabase Auth, NextAuth or any backend in about five minutes. Create a key on the
        dashboard Keys page, then pick your stack. Every integration fails open: if gatekeep is slow or down, the
        signup goes through.
      </p>
      <nav className="mt-6 flex flex-wrap gap-2 text-[12px]">
        {snippets.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="rounded-md border border-line px-2.5 py-1 text-muted hover:text-ink">
            {s.label}
          </a>
        ))}
      </nav>
      {snippets.map((s) => (
        <section key={s.id} id={s.id} className="mt-12 scroll-mt-8">
          <h2 className="text-[22px] font-light tracking-tight text-ink">{s.label}</h2>
          <p className="mt-1 text-[13px] text-muted">{s.intro}</p>
          {s.steps.map((st) => (
            <div key={st.title} className="mt-4">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">{st.title}</div>
              <pre className="overflow-x-auto rounded-md border border-line bg-[#0e0e10] p-3.5 font-mono text-[12px] leading-relaxed text-ink-2">
                {st.code}
              </pre>
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}
