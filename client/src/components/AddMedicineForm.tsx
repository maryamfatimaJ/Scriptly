import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/Button";
import * as medicationsApi from "@/api/medications";
import type { Medication } from "@/types";

// Adds a medicine without uploading a prescription. Everything is typed by
// the user, so the user is the one confirming it — the same three fields a
// prescription review requires (name, dose, how often) are required here.
// On success the caller moves straight on to setting up its schedule.
export function AddMedicineForm({ onAdded, onCancel }: { onAdded: (medication: Medication) => void; onCancel: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    strength: "",
    form: "",
    dosageInstructions: "",
    frequency: "",
    timing: "",
    durationDays: "",
    instructions: "",
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const mutation = useMutation({
    mutationFn: () =>
      medicationsApi.createManualMedication({
        name: form.name.trim(),
        strength: form.strength.trim() || undefined,
        form: form.form.trim() || undefined,
        dosageInstructions: form.dosageInstructions.trim(),
        frequency: form.frequency.trim(),
        timing: form.timing.trim() || undefined,
        durationDays: form.durationDays ? Number(form.durationDays) : undefined,
        instructions: form.instructions.trim() || undefined,
      }),
    onSuccess: ({ medication }) => {
      queryClient.invalidateQueries({ queryKey: ["medications"] });
      onAdded(medication);
    },
  });

  const valid = form.name.trim() && form.dosageInstructions.trim() && form.frequency.trim();

  return (
    <form
      className="rounded-2xl border border-charcoal/10 bg-mint/30 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) mutation.mutate();
      }}
    >
      <p className="font-medium">Add a medicine</p>
      <p className="mt-1 text-xs text-charcoal/70">
        Enter it exactly as your doctor or pharmacist told you. Scriptly uses what you type here — it doesn't fill anything in.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Medicine name *
          <input value={form.name} onChange={set("name")} className="field" placeholder="e.g. Metformin" required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Strength
          <input value={form.strength} onChange={set("strength")} className="field" placeholder="e.g. 500 mg" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Form
          <input value={form.form} onChange={set("form")} className="field" placeholder="e.g. tablet, syrup" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Dose each time *
          <input value={form.dosageInstructions} onChange={set("dosageInstructions")} className="field" placeholder="e.g. 1 tablet" required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          How often *
          <input value={form.frequency} onChange={set("frequency")} className="field" placeholder="e.g. twice daily, 1+0+1" required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          When
          <input value={form.timing} onChange={set("timing")} className="field" placeholder="e.g. after breakfast and dinner" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          For how many days
          <input type="number" min={1} value={form.durationDays} onChange={set("durationDays")} className="field" placeholder="leave empty if ongoing" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Other instructions
          <input value={form.instructions} onChange={set("instructions")} className="field" placeholder="e.g. avoid alcohol" />
        </label>
      </div>
      <div className="mt-5 flex items-center gap-3">
        <Button type="submit" disabled={!valid || mutation.isPending}>
          {mutation.isPending ? "Saving…" : "Save and set up reminders"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {mutation.isError && <p className="mt-3 text-sm text-red-700">{(mutation.error as Error).message}</p>}
    </form>
  );
}
