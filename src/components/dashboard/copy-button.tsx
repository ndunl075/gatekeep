"use client";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          // Clipboard blocked: the key is selectable text next to the button.
        }
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
      {done ? "Copied" : label}
    </Button>
  );
}
