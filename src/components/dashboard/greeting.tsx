"use client";
import { greetingFor } from "./helpers";

/** Greets by the viewer's local hour. The server renders UTC first; the client text wins after hydration. */
export function Greeting({ name }: { name: string }) {
  return <span suppressHydrationWarning>{`${greetingFor(new Date().getHours())}, ${name}`}</span>;
}
