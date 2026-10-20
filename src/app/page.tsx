import { Logo } from "@/components/ui";

// Placeholder. Replaced by the landing page PR.
export default function Home() {
  return (
    <div className="sky sky-noise relative grid min-h-screen place-items-center">
      <div className="text-center">
        <Logo size={28} className="mb-6" />
        <h1 className="text-5xl font-light tracking-tight">Stop free-credit farming.</h1>
      </div>
    </div>
  );
}
