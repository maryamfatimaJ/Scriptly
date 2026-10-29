import { useState } from "react";
import { ApiError } from "@/api/client";

// A delete control that asks once, inline, before doing anything
// irreversible — no modal. The caller's onConfirm must resolve only after
// the server has confirmed the deletion; the error, if any, is shown here.

export function ConfirmDeleteButton({
  label,
  confirmText,
  onConfirm,
}: {
  label: string;
  confirmText: string;
  onConfirm: () => Promise<unknown>;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setAsking(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete it. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="text-sm text-red-700 underline-offset-2 hover:underline"
      >
        {label}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm" role="group" aria-label={label}>
      <span className="text-charcoal/80">{confirmText}</span>
      <button
        type="button"
        onClick={confirm}
        disabled={busy}
        className="rounded-capsule bg-red-700 px-4 py-1.5 font-medium text-white hover:bg-red-800 disabled:opacity-60"
      >
        {busy ? "Deleting…" : "Yes, delete"}
      </button>
      <button type="button" onClick={() => setAsking(false)} disabled={busy} className="text-charcoal/70 hover:underline">
        Cancel
      </button>
      {error && (
        <p className="w-full text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
