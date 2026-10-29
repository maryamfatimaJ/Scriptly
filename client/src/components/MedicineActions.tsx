import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/api/client";
import * as medicationsApi from "@/api/medications";
import { MonographCard, PriceCard } from "@/components/scripty/ScriptyResultCard";

// Direct "look this medicine up" actions on a single medication.
//
// Scripty can already answer both of these in conversation, but a user
// looking at a specific medicine shouldn't have to compose a sentence to
// ask about the thing already in front of them. These buttons call the
// same backend services Scripty's tools call, and render the result with
// the same components, so the two routes can never disagree.
//
// Nothing is fetched until a panel is opened — label lookups hit a live
// external API, and firing them for every medication on a review screen
// would be both slow and rude to a free public service.

type Panel = "information" | "price";

function Failure({ label, error }: { label: string; error: unknown }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
      <p className="text-sm font-medium text-red-800">{label}</p>
      <p className="mt-1 text-sm text-red-700">
        {error instanceof ApiError ? error.message : "Please try again in a moment."}
      </p>
    </div>
  );
}

export function MedicineActions({
  medicationId,
  isConfirmed,
}: {
  medicationId: string;
  /** Unconfirmed names come from an unverified reading; say so. */
  isConfirmed: boolean;
}) {
  // A Set rather than a single value: opening "Check price" used to
  // collapse an open "Medicine information" panel, which is exactly the
  // comparison a user wants to make — what is this for, and what does
  // it cost.
  const [open, setOpen] = useState<Set<Panel>>(new Set());

  const toggle = (panel: Panel) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(panel)) next.add(panel);
      return next;
    });

  const information = useQuery({
    queryKey: ["medication", medicationId, "information"],
    queryFn: () => medicationsApi.getMedicationInformation(medicationId),
    enabled: open.has("information"),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const price = useQuery({
    queryKey: ["medication", medicationId, "price"],
    queryFn: () => medicationsApi.getMedicationPrice(medicationId),
    enabled: open.has("price"),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="mt-5 border-t border-charcoal/10 pt-5">
      <div className="flex flex-wrap items-center gap-2">
        {(["information", "price"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => toggle(key)}
            aria-expanded={open.has(key)}
            className={`rounded-capsule border px-4 py-2 t-nav transition-colors ${
              open.has(key)
                ? "border-forest bg-forest text-offwhite"
                : "border-charcoal/15 text-charcoal hover:border-charcoal/40"
            }`}
          >
            {key === "information" ? "Medicine information" : "Check price"}
          </button>
        ))}
      </div>

      {open.size > 0 && !isConfirmed && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          These details have not been confirmed yet, so this lookup is based on an unverified reading of your
          prescription. Check the name and strength above first.
        </p>
      )}

      {open.has("information") && (
        <div className="mt-4">
          {information.isFetching && <p className="t-body">Looking it up…</p>}
          {information.isError && (
            <Failure label="Medicine information lookup failed" error={information.error} />
          )}
          {information.data && (
            <MonographCard lookup={information.data.information} marketNote={information.data.marketNote} />
          )}
        </div>
      )}

      {open.has("price") && (
        <div className="mt-4">
          {price.isFetching && <p className="t-body">Checking the price…</p>}
          {price.isError && <Failure label="Price lookup failed" error={price.error} />}
          {price.data && <PriceCard result={price.data.price} />}
        </div>
      )}
    </div>
  );
}
