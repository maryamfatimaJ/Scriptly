import { Link } from "react-router-dom";
import type { MonographLookup, PriceLookupResult } from "@/types";

// Renders the STRUCTURED result behind a Scripty answer.
//
// This matters more than it looks: Scripty's prose is model-generated, so
// these cards are what the user can actually rely on. Prices, sources,
// dates and statuses are rendered from the tool result directly and never
// pass through the model. If the model's wording ever drifts, the card
// beneath it still shows the truth.

function SourceLine({ name, url, date }: { name?: string | null; url?: string | null; date?: string | null }) {
  if (!name && !url) return null;
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray">
      <span>Source: {name ?? "—"}</span>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="text-forest underline underline-offset-2">
          View original
        </a>
      )}
      {date && <span>· {new Date(date).toLocaleDateString()}</span>}
    </p>
  );
}

export function PriceCard({ result }: { result: PriceLookupResult }) {
  if (result.status === "VERIFIED") {
    const p = result.price;
    return (
      <div className="rounded-2xl border border-charcoal/10 bg-mint/30 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-medium text-charcoal">{p.brandName ?? p.genericName}</p>
          <p className="font-display text-xl text-forest">
            {p.currency} {p.amount}
          </p>
        </div>
        <p className="mt-1 text-sm text-charcoal/70">
          {[p.strength, p.formulation, p.packSize].filter(Boolean).join(" · ")}
        </p>
        {/* Never let a pack price read as a per-unit price. */}
        <p className="mt-2 text-sm text-charcoal/80">{p.priceBasis}</p>
        <p className="mt-2 inline-block rounded-capsule bg-forest/10 px-3 py-1 text-xs font-medium text-forest">
          {p.priceType === "OFFICIAL_MRP" ? "Official maximum retail price" : "Retailer's listed price"}
        </p>
        <SourceLine name={p.sourceName} url={p.sourceUrl} date={null} />
        <p className="mt-1 text-xs text-charcoal/70">
          {p.effectiveFrom && <>Price effective {new Date(p.effectiveFrom).toLocaleDateString()} · </>}
          {p.lastVerifiedAt ? <>last verified {new Date(p.lastVerifiedAt).toLocaleDateString()}</> : "verification date not recorded"}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-dashed border-charcoal/25 p-4">
      <p className="font-medium text-charcoal">Verified price unavailable</p>
      <p className="mt-1 text-sm text-charcoal/70">{result.reason}</p>

      {result.nearMisses.length > 0 && (
        <div className="mt-3 rounded-xl bg-offwhite p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-gray">
            Related records — not a price for what you asked
          </p>
          <ul className="mt-1 space-y-0.5 text-sm text-charcoal/70">
            {result.nearMisses.map((m, i) => (
              <li key={i}>
                {m.name} — {[m.strength, m.formulation, m.packSize].filter(Boolean).join(" · ") || "details not recorded"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.manualCheck.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-gray">Check the price yourself</p>
          <ul className="mt-1 space-y-1.5">
            {result.manualCheck.map((link) => (
              <li key={link.url} className="text-sm">
                <a href={link.url} target="_blank" rel="noreferrer" className="text-forest underline underline-offset-2">
                  {link.label}
                </a>
                <span className="block text-xs text-gray">{link.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Section({ title, body }: { title: string; body?: string | null }) {
  if (!body) return null;
  return (
    <div className="border-t border-charcoal/10 py-3 first:border-t-0">
      {/* charcoal/70, not `text-gray`: at 12px the grey measured ~4.2:1
          on the cream background, under the 4.5:1 AA floor for normal
          text. These head up drug warnings and side effects. */}
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal/70">{title}</p>
      <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-charcoal/85">{body}</p>
    </div>
  );
}

export function MonographCard({ lookup, marketNote }: { lookup: MonographLookup; marketNote?: string }) {
  if (lookup.status === "LOOKUP_FAILED") {
    return (
      <div className="rounded-2xl border border-amber-500/40 bg-amber-50 p-4">
        <p className="font-medium text-charcoal">Could not check medicine information</p>
        {/* Distinct from "no information exists" — the user is told which. */}
        <p className="mt-1 text-sm text-charcoal/75">{lookup.reason}</p>
      </div>
    );
  }

  if (lookup.status === "NOT_AVAILABLE") {
    return (
      <div className="rounded-2xl border border-dashed border-charcoal/25 p-4">
        <p className="font-medium text-charcoal">No verified information available</p>
        <p className="mt-1 text-sm text-charcoal/75">{lookup.reason}</p>
        <p className="mt-2 text-sm text-charcoal/70">
          Ask your pharmacist for the leaflet that came with the pack — that is the authoritative source for the
          product sold to you.
        </p>
      </div>
    );
  }

  const m = lookup.monograph;
  return (
    <div className="rounded-2xl border border-charcoal/10 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium text-charcoal">{m.displayName}</p>
        {/* The market badge is deliberately prominent — a US label is not
            a Pakistani product leaflet and must never be read as one. */}
        <span className="rounded-capsule bg-charcoal/10 px-2.5 py-0.5 text-xs font-medium text-charcoal">
          {m.market === "US" ? "US label" : m.market === "PAKISTAN" ? "Pakistan" : "International"}
        </span>
        {lookup.stale && (
          <span className="rounded-capsule bg-amber-100 px-2.5 py-0.5 text-xs text-amber-900">
            Cached — source unreachable
          </span>
        )}
      </div>

      {marketNote && <p className="mt-2 rounded-xl bg-mint/40 p-3 text-xs text-charcoal/80">{marketNote}</p>}

      <div className="mt-3">
        <Section title="What it is used for" body={m.uses} />
        <Section title="How it is taken" body={m.howToUse} />
        <Section title="Common side effects" body={m.sideEffects} />
        {/* Deliberately NOT folded into "side effects": this field is
            "stop use and ask a doctor if", which lists treatment-failure
            criteria, not adverse reactions. */}
        <Section title="When to stop and ask a doctor" body={m.whenToStop} />
        <Section title="Warnings" body={m.warnings} />
        <Section title="Precautions" body={m.precautions} />
        <Section title="Do not take if" body={m.contraindications} />
        <Section title="Storage" body={m.storage} />
      </div>

      <SourceLine name={m.sourceName} url={m.sourceUrl} date={m.labelUpdatedAt ?? m.retrievedAt} />
    </div>
  );
}

interface MedicationRow {
  id: string;
  name: string | null;
  strength?: string | null;
  frequency?: string | null;
  isConfirmed?: boolean;
  reviewStatus?: string;
}

export function MedicationListCard({ medications }: { medications: MedicationRow[] }) {
  if (medications.length === 0) {
    return <p className="rounded-2xl border border-dashed border-charcoal/25 p-4 text-sm text-charcoal/70">No medicines on record.</p>;
  }
  return (
    <ul className="space-y-2">
      {medications.map((m) => (
        <li key={m.id} className="rounded-2xl border border-charcoal/10 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-charcoal">
              {m.name ?? "Unnamed medicine"} {m.strength && <span className="text-charcoal/70">{m.strength}</span>}
            </p>
            {m.isConfirmed === false && (
              <span className="rounded-capsule bg-amber-100 px-2.5 py-0.5 text-xs text-amber-900">Needs your review</span>
            )}
          </div>
          {m.frequency && <p className="text-sm text-charcoal/70">{m.frequency}</p>}
        </li>
      ))}
    </ul>
  );
}

interface ScheduleRow {
  id: string;
  medicationName: string | null;
  status: string;
  times: string[];
}

export function ScheduleListCard({ schedules }: { schedules: ScheduleRow[] }) {
  if (schedules.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-charcoal/25 p-4 text-sm text-charcoal/70">
        No schedules yet. Ask Scripty to set one up for a confirmed medicine.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {schedules.map((s) => (
        <li key={s.id} className="rounded-2xl border border-charcoal/10 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-charcoal">{s.medicationName ?? "Medicine"}</p>
            <span className="rounded-capsule bg-charcoal/10 px-2.5 py-0.5 text-xs">{s.status}</span>
          </div>
          <p className="text-sm text-charcoal/70">{s.times.join(" · ")}</p>
        </li>
      ))}
      <li>
        <Link to="/schedule" className="text-sm text-forest underline underline-offset-2">
          Open the Schedule page
        </Link>
      </li>
    </ul>
  );
}

/** Dispatches on the tool that produced the data. */
export function ScriptyResultCard({ tool, data }: { tool: string | null; data: unknown }) {
  if (!data || !tool) return null;
  const payload = data as Record<string, any>;

  switch (tool) {
    case "check_medicine_price":
      return payload.price ? <PriceCard result={payload.price as PriceLookupResult} /> : null;
    case "get_medicine_information":
      return payload.information ? (
        <MonographCard lookup={payload.information as MonographLookup} marketNote={payload.marketNote} />
      ) : null;
    case "summarize_prescription":
    case "list_my_medications":
      return <MedicationListCard medications={payload.medications ?? []} />;
    case "list_my_schedules":
      return <ScheduleListCard schedules={payload.schedules ?? []} />;
    case "check_reminder_delivery":
      return (
        <div
          className={`rounded-2xl border p-4 ${
            payload.emailConfigured ? "border-forest/30 bg-mint/30" : "border-amber-500/40 bg-amber-50"
          }`}
        >
          <p className="font-medium text-charcoal">
            {payload.emailConfigured ? "Email reminders are configured" : "Email reminders are not configured"}
          </p>
          <p className="mt-1 text-sm text-charcoal/75">{payload.explanation}</p>
        </div>
      );
    default:
      return null;
  }
}
