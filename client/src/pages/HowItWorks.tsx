import { clsx } from "clsx";
import { HeroPhoto } from "@/components/HeroPhoto";
import { Disclaimer } from "@/components/Disclaimer";

// Step photos: free to use under the Unsplash License (unsplash.com/license).
// To replace one, change its `image.src` — a /images/... file in
// client/public/images or another licensed URL. The frame crops to 4:3.
const STEPS = [
  {
    number: "01",
    title: "Capture",
    copy:
      "Photograph your prescription in good light, or upload an existing image or PDF. We check focus and framing before you move on, so nothing illegible slips through.",
    // Default stock photo (see HeroPhoto.tsx): blister packs of medicine.
    image: undefined,
  },
  {
    number: "02",
    title: "Review",
    copy:
      "Candidate medication names, strengths, and instructions are extracted for you to check against the original — side by side, field by field. Anything uncertain is flagged, never guessed.",
    // "Woman Consults with Pharmacist" — National Cancer Institute (photographer Rhoda Baer), Unsplash.
    image: {
      src: "https://images.unsplash.com/photo-1576091358783-a212ec293ff3?auto=format&fit=crop&w=900&q=80",
      alt: "A pharmacist explaining a prescription bottle to a patient at the pharmacy counter",
    },
  },
  {
    number: "03",
    title: "Organize",
    copy:
      "Once you confirm a medication's instructions, it becomes part of your schedule: daily reminders, a taken/missed record, and a single place to see every active prescription.",
    // "Young woman taking medicine from a pill box" — Towfiqu barbhuiya, Unsplash.
    image: {
      src: "https://images.unsplash.com/photo-1624711076872-ecdbc5ade023?auto=format&fit=crop&w=900&q=80",
      alt: "A hand taking a tablet from a weekly pill organizer",
    },
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
                <HeroPhoto className="h-full w-full" src={step.image?.src} alt={step.image?.alt} />
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
