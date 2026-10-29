import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/Button";
import { CapsuleMotif } from "@/components/CapsuleMotif";
import { Hero3D } from "@/components/hero/Hero3D";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

// Homepage art direction.
//
// Composition principles, each doing a specific job — not decoration:
//
//   1. ASYMMETRIC SPLIT WITH A BLEEDING FORM. The hero is not a contained
//      two-column grid. On desktop the right panel runs flush off the
//      right and bottom edges of the viewport, with a large radius on its
//      top-left corner only — the one corner where it meets the white.
//   2. EXTREME TYPE CONTRAST. The headline is roughly 5x the lead
//      paragraph and set tight enough that its two lines read as a single
//      mass. Nothing else on the page is allowed to compete.
//   3. A THIN GEOMETRIC CONNECTOR. The L-rule between headline and lead
//      is the signature detail. One line, no shadow, no container.
//   4. ONE VISUAL OBJECT. The capsule, at architectural scale. No feature
//      cards, statistics, testimonials or dashboard in the hero.
//
// Every section below deliberately differs in background, rhythm and
// alignment. Three identical rounded card grids is the failure mode this
// layout exists to avoid.

// The three steps, written to describe what the application ACTUALLY
// does today. Deliberately avoided: any promise that every medicine has
// a verified price or a complete information record. Neither is true —
// there is no permitted bulk source for Pakistani prices, and openFDA
// has no label for many medicines sold here. Saying "where available"
// is not hedging; it is the accurate description.
const STEPS = [
  {
    number: "01",
    title: "Capture",
    headline: "Start with a clear photo of your prescription.",
    copy: "Photograph it with your camera or upload an image you already have. We guide the lighting and framing first, because a legible photo is the difference between a useful reading and a guess.",
  },
  {
    number: "02",
    title: "Review",
    headline: "Every detail deserves a second look.",
    copy: "The AI reads only what is visible and shows each extracted field beside your original image. Anything it could not read clearly is flagged rather than filled in, and nothing is scheduled until you have confirmed it yourself.",
  },
  {
    number: "03",
    title: "Understand & organize",
    headline: "Know your medicines. Build a routine that works for you.",
    copy: "Look up what a confirmed medicine is for, its ingredients and common side effects, and check Pakistani prices where a verified record exists. Ask Scripty about your prescription, then turn confirmed medicines into a reminder schedule you control.",
  },
];

// Illustrative only — see the "Example" label rendered alongside it. This
// is the one place on the site where invented medicines are acceptable,
// because the UI itself is the subject.
const DEMO_DOSES = [
  { time: "08:00", name: "Amoxicillin", detail: "500 mg · with breakfast", state: "taken" as const },
  { time: "14:00", name: "Amoxicillin", detail: "500 mg · after lunch", state: "due" as const },
  { time: "21:00", name: "Amoxicillin", detail: "500 mg · after dinner", state: "upcoming" as const },
];

export function Home() {
  const navigate = useNavigate();
  const prefersReducedMotion = usePrefersReducedMotion();

  const rise = prefersReducedMotion
    ? {}
    : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 } };

  return (
    <div>
      {/* ================================================================ HERO */}
      {/* The 3D capsule scene, integrated from the supplied hero_Section
          implementation. Everything below this section is unchanged. */}
      <Hero3D />

      {/* ======================================================= HOW IT WORKS */}
      {/* Editorial list, not a card grid: full-width rows divided by
          hairlines, with the numeral used as a graphic element. */}
      <section className="border-t border-charcoal/10">
        <div className="mx-auto max-w-content px-6 py-20 sm:py-28">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,22rem)_1fr] lg:gap-20">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <p className="t-eyebrow">The process</p>
              <h2 className="mt-5 max-w-[15ch] text-balance t-h2">Three steps, and you confirm every one.</h2>
              <Link
                to="/how-it-works"
                className="mt-7 inline-block border-b border-forest/40 pb-0.5 text-forest t-nav transition-colors hover:border-forest"
              >
                See the full walkthrough →
              </Link>
            </div>

            <ol className="min-w-0">
              {STEPS.map((step, index) => (
                <li
                  key={step.number}
                  className={`grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 py-8 sm:gap-x-10 ${
                    index === 0 ? "pt-0" : "border-t border-charcoal/10"
                  }`}
                >
                  <span aria-hidden="true" className="text-sage t-numeral">
                    {step.number}
                  </span>
                  <div className="min-w-0 self-center">
                    <p className="t-eyebrow">{step.title}</p>
                    <h3 className="mt-2.5 max-w-[24ch] text-balance t-h3 text-[1.0625rem] leading-snug">{step.headline}</h3>
                    <p className="mt-2.5 max-w-prose t-body">{step.copy}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ====================================================== ROUTINE PREVIEW */}
      {/* Deliberate tonal inversion — a dark band between two light
          sections gives the page a rhythm that repeated white sections
          with different headings cannot. */}
      <section className="bg-forest text-offwhite">
        <div className="mx-auto grid max-w-content items-center gap-14 px-6 py-20 sm:py-28 lg:grid-cols-[1fr_minmax(0,26rem)] lg:gap-24">
          <div>
            <p className="t-eyebrow !text-offwhite/55">Your routine</p>
            <h2 className="mt-5 max-w-[16ch] text-balance t-h2">A day you can read at a glance.</h2>
            <p className="mt-6 max-w-md t-lead !text-offwhite/75">
              Once a medicine is confirmed, its doses become a schedule in your own timezone — with every
              reminder recorded as scheduled, taken, or missed. No dose is ever invented from an unconfirmed
              reading.
            </p>
          </div>

          <div className="relative">
            {/* Not faint: this is a "don't mistake this for your own
                medicines" label, and at offwhite/50 it measured ~3.3:1
                against the forest ground — below WCAG AA. */}
            <p className="mb-3 t-meta !text-offwhite/80">Example — not your data</p>
            <div className="overflow-hidden rounded-2xl bg-offwhite text-charcoal">
              <div className="flex items-baseline justify-between border-b border-charcoal/10 px-5 py-4">
                <span className="t-h3">Today</span>
                <span className="t-meta">3 doses</span>
              </div>
              <ul>
                {DEMO_DOSES.map((dose) => (
                  <li
                    key={dose.time}
                    className="flex items-center gap-4 border-b border-charcoal/[0.07] px-5 py-3.5 last:border-b-0"
                  >
                    <span className="w-12 shrink-0 tabular-nums t-meta">{dose.time}</span>
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        dose.state === "taken"
                          ? "bg-forest"
                          : dose.state === "due"
                            ? "bg-sage"
                            : "bg-charcoal/20"
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{dose.name}</span>
                      <span className="block truncate t-meta">{dose.detail}</span>
                    </span>
                    <span className="shrink-0 t-meta">
                      {dose.state === "taken" ? "Taken" : dose.state === "due" ? "Due" : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================= CLOSING CTA */}
      {/* Quiet and wide. The mark returns at small scale, closing the loop
          opened by the hero. */}
      <section className="border-t border-charcoal/10">
        <div className="mx-auto flex max-w-content flex-col gap-10 px-6 py-20 sm:flex-row sm:items-end sm:justify-between sm:py-28">
          <div>
            <CapsuleMotif className="h-6 w-[3.3rem]" />
            <h2 className="mt-7 max-w-[14ch] text-balance t-h2">A clearer routine starts here.</h2>
          </div>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4 lg:pb-1">
            <Button className="px-8 py-3.5" onClick={() => navigate("/capture")}>
              Scan prescription
            </Button>
            <p className="max-w-[22ch] t-meta">
              Extracted details are drafts, not diagnoses. You confirm every field.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
