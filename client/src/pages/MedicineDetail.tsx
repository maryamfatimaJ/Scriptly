import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/api/client";
import { Button } from "@/components/Button";
import { MonographCard, PriceCard } from "@/components/scripty/ScriptyResultCard";
import { ScriptyChat } from "@/components/scripty/ScriptyChat";
import * as medicinesApi from "@/api/medicines";

// Medicine detail page.
//
// Reuses the same MonographCard / PriceCard components Scripty renders, so
// a medicine looked up through the assistant and the same medicine opened
// from search show identical information with identical attribution.
// Two renderers would eventually disagree, and the one that drifted would
// be the one showing a patient a price or a side effect.

const UNAVAILABLE = "Information unavailable";

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-4 border-b border-charcoal/10 py-2.5 text-sm last:border-b-0">
      <span className="text-gray">{label}</span>
      <span className={`text-right ${value ? "text-charcoal" : "text-gray"}`}>{value || UNAVAILABLE}</span>
    </div>
  );
}

const PROVENANCE_LABEL: Record<string, string> = {
  DRAP: "DRAP",
  OPENFDA: "openFDA",
  WHO_EML: "WHO Essential Medicines List",
  RXNORM: "RxNorm",
  MANUAL: "Manual entry",
  OTHER: "Other permitted source",
};

export function MedicineDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [askOpen, setAskOpen] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["medicines", "detail", id],
    queryFn: () => medicinesApi.getMedicine(id as string),
    enabled: Boolean(id),
    retry: false,
  });

  if (isLoading) {
    return <div className="mx-auto max-w-content px-6 py-24 text-center text-charcoal/70">Loading medicine…</div>;
  }

  if (isError || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="mx-auto max-w-content px-6 py-24 text-center">
        <p className="font-display text-2xl">{notFound ? "Medicine not found" : "Couldn't load this medicine"}</p>
        <p className="mx-auto mt-3 max-w-md text-charcoal/70">
          {error instanceof ApiError ? error.message : "Please try again in a moment."}
        </p>
        <Button className="mt-6" onClick={() => navigate("/medicines")}>
          Back to search
        </Button>
      </div>
    );
  }

  const { medicine, information, price, disclaimer, formMismatch, packs, sources } = data;
  const name = medicine.brandName ?? medicine.genericName;
  const isUsLabel = information.status === "FOUND" && information.monograph.market === "US";

  return (
    <div className="mx-auto max-w-content px-6 py-16 sm:py-20">
      <Link to="/medicines" className="text-sm text-forest underline underline-offset-2">
        ← Back to search
      </Link>

      <header className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="font-display text-4xl">{name}</h1>
          <p className="mt-2 text-charcoal/70">
            {medicine.activeIngredient}
            {medicine.strength ? ` · ${medicine.strength}` : ""}
            {medicine.formulation ? ` · ${medicine.formulation}` : ""}
          </p>
        </div>
        <Button variant="secondary" onClick={() => setAskOpen((open) => !open)}>
          {askOpen ? "Close Scripty" : "Ask Scripty about this medicine"}
        </Button>
      </header>

      {askOpen && (
        <section className="mt-6 h-[560px] max-w-3xl">
          <ScriptyChat
            medicineId={medicine.id}
            onClose={() => setAskOpen(false)}
            greeting={`Ask me about ${name}. I'll explain the information Scriptly has for it in plain language, and tell you what isn't known.`}
          />
        </section>
      )}

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_1.4fr]">
        <div className="flex flex-col gap-6 lg:sticky lg:top-24 lg:self-start">
          <section className="rounded-3xl border border-charcoal/10 p-6">
            <h2 className="font-display text-xl">Product details</h2>
            <div className="mt-4">
              <Row label="Brand" value={medicine.brandName} />
              <Row label="Generic name" value={medicine.genericName} />
              <Row label="Active ingredient" value={medicine.activeIngredient} />
              <Row label="Strength" value={medicine.strength} />
              <Row label="Dosage form" value={medicine.formulation} />
              <Row label="Pack size" value={medicine.packSize} />
              <Row label="Manufacturer / licence holder" value={medicine.manufacturer} />
              <Row label="Market" value={medicine.countryOrMarket} />
              <Row label="DRAP registration no." value={medicine.registrationId} />
            </div>
            {packs.length > 0 && (
              <div className="mt-4">
                <p className="text-sm text-gray">Other packs of this product</p>
                <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                  {packs.map((pack) => (
                    <li key={pack.id}>
                      <Link to={`/medicines/${pack.id}`} className="text-forest underline underline-offset-2">
                        {pack.packSize ?? "Pack size not recorded"}
                      </Link>
                      {pack.price && (
                        <span className="text-charcoal/70">
                          {" "}
                          · {pack.price.currency} {pack.price.amount}{" "}
                          {pack.price.priceType === "OFFICIAL_MRP" ? "(official MRP)" : "(retailer price)"}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-4 border-t border-charcoal/10 pt-3 text-xs text-gray">
              <p>
                Record: {PROVENANCE_LABEL[medicine.dataProvenance] ?? medicine.dataProvenance} ·{" "}
                {medicine.verificationStatus === "VERIFIED" ? "Verified" : "Not verified"}
                {medicine.lastVerifiedAt
                  ? ` · last verified ${new Date(medicine.lastVerifiedAt).toLocaleDateString()}`
                  : " · last-verified date unavailable"}
              </p>
              {sources.length > 0 ? (
                <ul className="mt-1.5 flex flex-col gap-1">
                  {sources.map((source, i) => (
                    <li key={`${source.sourceName}-${i}`}>
                      Source:{" "}
                      {source.sourceUrl ? (
                        <a href={source.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                          {source.sourceName}
                        </a>
                      ) : (
                        source.sourceName
                      )}
                      {" · "}retrieved {new Date(source.retrievedAt).toLocaleDateString()}
                      {source.permissionBasis && ` · ${source.permissionBasis}`}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5">Source: {UNAVAILABLE.toLowerCase()}</p>
              )}
            </div>
          </section>

          <section>
            <h2 className="mb-3 font-display text-xl">Price in Pakistan</h2>
            <PriceCard result={price} />
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <section>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-xl">Medicine information</h2>
            </div>

            {/* Said once, clearly, above the label text rather than buried
                under it: this is US labelling for the ingredient, not the
                Pakistani leaflet for this specific product. */}
            {isUsLabel && (
              <p className="mb-3 rounded-2xl bg-mint/40 p-4 text-sm text-charcoal/80">
                This is <strong>United States FDA label information</strong> for {medicine.activeIngredient}, the
                active ingredient. It is published by the U.S. FDA and is not the Pakistani product leaflet for{" "}
                {name} — approved uses, pack sizes and wording can differ. Scriptly has no permitted source for
                Pakistani leaflets yet, so it shows this rather than nothing, labelled for what it is.
              </p>
            )}

            {/* A dosage-form mismatch is a genuine hazard: the dosing
                text below may describe swallowing a tablet when the
                product in the user's hand is a capsule. We can't
                reconcile it, so we say so instead of hiding it. */}
            {formMismatch && (
              <p className="mb-3 rounded-2xl border border-amber-500/50 bg-amber-50 p-4 text-sm text-amber-900">
                <strong>Check the dosage form.</strong> This product is recorded as a{" "}
                <strong>{formMismatch.productForm}</strong>, but the label text below describes a{" "}
                <strong>{formMismatch.labelForms.join(" / ")}</strong>. The "How it is taken" section may not
                match the product you have. Follow the instructions on your own pack and prescription.
              </p>
            )}

            <MonographCard lookup={information} />
          </section>

          <p className="rounded-2xl border border-charcoal/10 bg-offwhite p-4 text-sm text-charcoal/70">{disclaimer}</p>
        </div>
      </div>
    </div>
  );
}
