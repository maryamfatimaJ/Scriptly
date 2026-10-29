import type { Medication, MedicineMatchStatus } from "@/types";

const STATUS_LABEL: Record<MedicineMatchStatus, string> = {
  NOT_EVALUATED: "Not checked yet",
  VERIFIED_MATCH: "Verified match",
  POSSIBLE_MATCH: "Possible match",
  MULTIPLE_MATCHES: "Multiple matches",
  NO_VERIFIED_RECORD: "No verified record",
};

const STATUS_STYLE: Record<MedicineMatchStatus, string> = {
  NOT_EVALUATED: "bg-charcoal/10 text-charcoal",
  VERIFIED_MATCH: "bg-forest text-offwhite",
  POSSIBLE_MATCH: "bg-amber-100 text-amber-800",
  MULTIPLE_MATCHES: "bg-amber-100 text-amber-800",
  NO_VERIFIED_RECORD: "bg-charcoal/10 text-charcoal",
};

interface MedicineMatchPanelProps {
  medication: Medication;
  onSelect: (medicineReferenceId: string | null) => void;
  disabled?: boolean;
}

export function MedicineMatchPanel({ medication, onSelect, disabled }: MedicineMatchPanelProps) {
  const status = medication.referenceMatchStatus;
  const candidates = medication.referenceMatchCandidates ?? [];
  const verified = medication.medicineReference;

  return (
    <div className="rounded-2xl border border-charcoal/10 bg-mint/20 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Medicine reference</p>
        <span className={`rounded-capsule px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>
          {STATUS_LABEL[status]}
        </span>
      </div>

      {status === "VERIFIED_MATCH" && verified && (
        <div className="mt-3 text-sm text-charcoal/80">
          <p>
            <span className="text-gray">Generic:</span> {verified.genericName}
            {verified.brandName && <> · <span className="text-gray">Brand:</span> {verified.brandName}</>}
          </p>
          <p className="mt-1">
            {[verified.strength, verified.formulation].filter(Boolean).join(" · ") || "—"}
            {verified.manufacturer && ` · ${verified.manufacturer}`}
          </p>
          <p className="mt-1 text-xs text-gray">
            {verified.referencePrice ? `${verified.currency} ${verified.referencePrice}` : "No verified price available."}
          </p>
        </div>
      )}

      {(status === "POSSIBLE_MATCH" || status === "MULTIPLE_MATCHES") && (
        <div className="mt-3">
          <p className="text-xs text-charcoal/70">
            {status === "MULTIPLE_MATCHES"
              ? "More than one reference record could match — pick the one that matches the package, or none if unsure."
              : "This is a possible match, not confirmed — the strength or form didn't line up exactly."}
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {candidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                disabled={disabled}
                onClick={() => onSelect(candidate.id)}
                className="rounded-xl border border-charcoal/15 bg-offwhite px-3 py-2 text-left text-sm hover:border-forest disabled:opacity-50"
              >
                <span className="font-medium">{candidate.genericName}</span>
                {candidate.brandName && <span className="text-charcoal/70"> · {candidate.brandName}</span>}
                <span className="block text-xs text-gray">
                  {[candidate.strength, candidate.formulation, candidate.manufacturer].filter(Boolean).join(" · ")}
                </span>
              </button>
            ))}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSelect(null)}
              className="text-left text-xs text-gray underline-offset-2 hover:underline disabled:opacity-50"
            >
              None of these match
            </button>
          </div>
        </div>
      )}

      {status === "NO_VERIFIED_RECORD" && (
        <p className="mt-2 text-xs text-charcoal/70">
          No verified record for this medicine in the reference database yet.
        </p>
      )}
    </div>
  );
}
