"use client";
import { revokeKeyAction } from "@/app/dashboard/actions";
import { Button } from "@/components/ui";

export function RevokeButton({ keyId, name }: { keyId: string; name: string }) {
  return (
    <form
      action={revokeKeyAction}
      onSubmit={(e) => {
        if (!confirm(`Revoke "${name}"? Anything using this key will start getting 401s.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="keyId" value={keyId} />
      <Button type="submit" variant="danger" className="h-7 px-2.5 text-[12px]">
        Revoke
      </Button>
    </form>
  );
}
