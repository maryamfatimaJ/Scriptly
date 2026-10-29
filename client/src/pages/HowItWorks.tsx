import { clsx } from "clsx";
import { HeroPhoto } from "@/components/HeroPhoto";
import { Disclaimer } from "@/components/Disclaimer";

const STEPS = [
  {
    number: "01",
    title: "Capture",
    copy:
      "Photograph your prescription in good light, or upload an existing image or PDF. We check focus and framing before you move on, so nothing illegible slips through.",
  },
  {
    number: "02",
    title: "Review",
    copy:
      "Candidate medication names, strengths, and instructions are extracted for you to check against the original — side by side, field by field. Anything uncertain is flagged, never guessed.",
  },
  {
    number: "03",
    title: "Organize",
    copy:
      "Once you confirm a medication's instructions, it becomes part of your schedule: daily reminders, a taken/missed record, and a single place to see every active prescription.",
  },
];

export function HowItWorks() {
  return (
    <div className="mx-auto max-w-content px-6 py-16 sm:py-20">
      <header className="max-w-2xl">
        <p className="mb-4 text-xs font-medium uppercase tracking-[0.2em] text-forest">How it works</p>
        <h1 className="font-display text-4xl sm:text-5xl">From paper to routine, in three reviewed steps.</h1>
      </header>

      <div className="mt-20 flex flex-col gap-24">
        {STEPS.map((step, index) => {
          const imageFirst = index % 2 === 1;
          return (
            <div
              key={step.number}
              className={clsx(
                "grid items-center gap-10 border-t border-charcoal/10 pt-12 sm:grid-cols-2 sm:gap-16"
              )}
            >
              <div className={clsx(imageFirst && "sm:order-2")}>
                <span className="font-display text-6xl text-sage sm:text-7xl">{step.number}</span>
                <h2 className="mt-4 font-display text-3xl">{step.title}</h2>
                <p className="mt-4 max-w-md text-charcoal/75">{step.copy}</p>
              </div>
              <div className={clsx("aspect-[4/3] overflow-hidden rounded-3xl", imageFirst && "sm:order-1")}>
                <HeroPhoto className="h-full w-full" />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-20 border-t border-charcoal/10 pt-8">
        <Disclaimer />
      </div>
    </div>
  );
}
