"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Joins the invitation's book (POST /api/v1/invitations/{token}), then goes home, where the book is now.
export function JoinBook({ token, join, failed }: { token: string; join: string; failed: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function accept() {
    setBusy(true);
    setError(false);
    const res = await fetch(`/api/v1/invitations/${encodeURIComponent(token)}`, { method: "POST" }).catch(() => null);
    if (!res?.ok) {
      setBusy(false);
      return setError(true);
    }
    router.push("/");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={accept}
        disabled={busy}
        aria-describedby="join-error"
        className="block w-full rounded-full bg-carbon px-4 py-2.5 text-center font-bold text-on-carbon disabled:opacity-60"
      >
        {join}
      </button>
      <p id="join-error" role="alert" className="mt-3 text-sm text-error">
        {error ? failed : ""}
      </p>
    </>
  );
}
