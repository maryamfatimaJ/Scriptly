import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { PriceCard } from "@/components/scripty/ScriptyResultCard";
import * as prescriptionsApi from "@/api/prescriptions";
import { WEEKDAYS } from "@/components/CreateScheduleForm";

function daysLabel(days: number[]) {
  if (days.length === 0) return "every day";
  return days.map((d) => WEEKDAYS.find((w) => w.iso === d)?.short).join(", ");
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// The completion screen for an approved prescription. Everything shown is
// read back from the server AFTER it was saved (GET /prescriptions/:id/
// summary) — never echoed from what the form submitted — so "saved" here
// always means the backend actually recorded it.
export function PrescriptionSummary({ prescriptionId }: { prescriptionId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["prescription-summary", prescriptionId],
    queryFn: () => prescriptionsApi.getPrescriptionSummary(prescriptionId),
  });

  if (isLoading) return <p className="text-sm text-charcoal/70">Loading what was saved…</p>;
  if (isError || !data) return <p className="text-sm text-red-700">We couldn't load the saved details. Please refresh.</p>;

  return (
    <section className="flex flex-col gap-6" aria-labelledby="summary-title">
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-forest">Saved</p>
        <h2 id="summary-title" className="font-display text-3xl">
          Your confirmed prescription
        </h2>
        <p className="mt-2 text-sm text-charcoal/75">
          {data.medicines.length} medicine{data.medicines.length === 1 ? "" : "s"} confirmed
          {data.removedCount > 0 ? `, ${data.removedCount} removed` : ""}. This is what Scriptly has stored.
        </p>
      </div>

      {data.medicines.map((m) => (
        <article key={m.medicationId} className="rounded-3xl border border-charcoal/10 p-6">
          <h3 className="font-display text-xl">
            {m.name}
            {m.strength ? ` ${m.strength}` : ""}
            {m.form ? <span className="text-base text-charcoal/70"> · {m.form}</span> : null}
          </h3>
          {m.genericName && <p className="text-sm text-charcoal/70">{m.genericName}</p>}

          <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {[
              ["Dose", m.dosageInstructions],
              ["Frequency", m.frequency],
              ["Timing", m.timing],
              ["Duration", m.durationDays ? `${m.durationDays} days` : null],
              ["Route", m.route],
              ["Quantity", m.quantity],
              ["Other instructions", m.instructions],
            ]
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-xs uppercase tracking-wide text-charcoal/70">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>

          <div className="mt-5">
            <p className="text-xs font-medium uppercase tracking-wide text-charcoal/70">Reminder schedule</p>
            {m.schedules.length === 0 ? (
              <p className="mt-1 text-sm text-amber-800">No schedule saved yet.</p>
            ) : (
              m.schedules.map((s) => (
                <div key={s.id} className="mt-2 text-sm">
                  <div className="flex flex-wrap gap-2">
                    {s.times.map((t) => (
                      <span key={t.timeOfDay} className="rounded-capsule bg-forest px-3 py-1 text-offwhite">
                        {t.timeOfDay}
                        {t.label ? ` · ${t.label}` : ""}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-charcoal/75">
                    {s.doseAmount ? `${s.doseAmount} each time · ` : ""}
                    {daysLabel(s.daysOfWeek)} · from {formatDate(s.startDate)}
                    {s.endDate ? ` to ${formatDate(s.endDate)}` : " · ongoing"}
                    {s.status === "PAUSED" ? " · paused" : ""}
                    {!s.remindersEnabled ? " · notifications off" : ""}
                  </p>
                </div>
              ))
            )}
          </div>

          <div className="mt-5">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-charcoal/70">Price in Pakistan</p>
            {m.price ? <PriceCard result={m.price} /> : <p className="text-sm">Verified price unavailable.</p>}
          </div>
        </article>
      ))}

      {data.outstanding.length > 0 && (
        <div className="rounded-3xl bg-amber-50 p-6">
          <p className="font-medium text-amber-900">Still needs your attention</p>
          <ul className="mt-2 flex flex-col gap-2 text-sm text-amber-900">
            {data.outstanding.map((item, i) => (
              <li key={i}>
                <span className="font-medium">{item.name ?? "Unnamed medicine"}:</span> {item.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-sm text-charcoal/75">
        {data.reminderDelivery.explanation}{" "}
        <Link to="/schedule" className="text-forest underline underline-offset-2">
          Open your schedule
        </Link>
      </p>
    </section>
  );
}
