import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/Button";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import "@/styles/hero3d.css";

// Scriptly's homepage hero, built on the supplied 3D capsule scene.
//
// WHAT CAME FROM THE SUPPLIED IMPLEMENTATION
//   The capsule itself — geometry, materials, lighting, contact shadows,
//   the GSAP intro and open/close animation, the idle float — plus the
//   halo, orbit rings, ambient dots and dotted grid that frame it. Those
//   are preserved as authored; see CapsuleScene.tsx.
//
// WHAT WAS DELIBERATELY LEFT BEHIND
//   The reference page shipped a complete landing page around that
//   capsule. None of the following is reproduced here, because none of it
//   is true of Scriptly or belongs to it:
//     - its own navbar and "medimind" brand (Scriptly's navbar is the
//       single source of truth and is untouched)
//     - the "Ask your AI pharmacist" CTA
//     - avatar stack, 4.9 star rating, "Trusted by 12,000+ patients"
//     - "Safety checked / 256 interactions" and "Prescription status"
//       floating chips
//     - the "Explore the capsule" control card
//     - the HIPAA-compliant / Pharmacist-reviewed / trust bar
//   Those are invented counts, ratings and compliance claims. Shipping
//   them would be a lie regardless of how good they look.
//
// The copy, CTAs and routes below are Scriptly's existing ones, carried
// over unchanged from the previous hero.

// three.js + fiber + drei is a large dependency. Loading it lazily keeps
// it out of the initial bundle, so the headline and CTA paint without
// waiting on a WebGL renderer most of the page does not need.
const CapsuleScene = lazy(() =>
  import("./CapsuleScene").then((module) => ({ default: module.CapsuleScene }))
);

/** Static stand-in shown until the 3D scene has loaded. Matches the no-WebGL fallback. */
function CapsulePlaceholder() {
  return (
    <div className="sc-hero__fallback" aria-hidden="true">
      <span className="sc-hero__fallback-half sc-hero__fallback-half--blue" />
      <span className="sc-hero__fallback-half sc-hero__fallback-half--white" />
    </div>
  );
}

export function Hero3D() {
  const navigate = useNavigate();
  const prefersReducedMotion = usePrefersReducedMotion();

  const [capsuleOpen, setCapsuleOpen] = useState(false);
  const [inView, setInView] = useState(true);
  const visualRef = useRef<HTMLDivElement>(null);

  // Auto-close, as in the supplied implementation, so the capsule returns
  // to rest rather than sitting open indefinitely.
  useEffect(() => {
    if (!capsuleOpen) return;
    const timeout = window.setTimeout(() => setCapsuleOpen(false), 4200);
    return () => window.clearTimeout(timeout);
  }, [capsuleOpen]);

  // Park the WebGL render loop once the hero scrolls away. Without this
  // the canvas keeps repainting behind several screens of content.
  useEffect(() => {
    const element = visualRef.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: "120px" }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const rise = prefersReducedMotion
    ? {}
    : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 } };

  return (
    <section className="sc-hero" aria-labelledby="hero-title">
      <div className="sc-hero__ambient sc-hero__ambient--one" aria-hidden="true" />
      <div className="sc-hero__ambient sc-hero__ambient--two" aria-hidden="true" />
      <div className="sc-hero__grid" aria-hidden="true" />

      <div className="sc-hero__inner">
        <div className="sc-hero__copy">
          <motion.p {...rise} transition={{ duration: 0.5 }} className="t-eyebrow">
            Prescription care, simplified
          </motion.p>

          <motion.h1
            {...rise}
            id="hero-title"
            transition={{ duration: 0.6, delay: 0.05 }}
            className="mt-7 max-w-[14ch] text-balance text-charcoal t-display"
          >
            Your prescription, understood.
          </motion.h1>

          {/* Scriptly's L-rule, kept from the previous hero — borders on
              two sides of an empty box. */}
          <motion.div
            {...rise}
            transition={{ duration: 0.6, delay: 0.12 }}
            className="sc-hero__lead-row mt-9 flex items-end gap-5"
          >
            <span
              aria-hidden="true"
              className="h-14 w-9 shrink-0 border-b border-l border-charcoal/20 sm:h-16 sm:w-11"
            />
            <p className="max-w-sm pb-0.5 t-lead">
              Turn your prescription into a clearer, more manageable medication routine.
            </p>
          </motion.div>

          <motion.div
            {...rise}
            transition={{ duration: 0.6, delay: 0.18 }}
            className="sc-hero__actions mt-10 flex flex-wrap items-center gap-x-8 gap-y-4"
          >
            <Button className="px-8 py-3.5" onClick={() => navigate("/capture")}>
              Scan prescription
            </Button>
            <Link to="/how-it-works" className="group inline-flex items-center gap-2 text-charcoal t-nav">
              <span className="border-b border-charcoal/30 pb-0.5 transition-colors group-hover:border-charcoal">
                How it works
              </span>
              <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
                →
              </span>
            </Link>
          </motion.div>
        </div>

        <div className="sc-hero__visual" ref={visualRef}>
          <div className="sc-hero__halo" aria-hidden="true" />
          <div className="sc-hero__orbit sc-hero__orbit--large" aria-hidden="true">
            <span className="sc-hero__dot sc-hero__dot--one" />
            <span className="sc-hero__dot sc-hero__dot--two" />
          </div>
          <div className="sc-hero__orbit sc-hero__orbit--small" aria-hidden="true" />

          <div className="sc-hero__canvas">
            <Suspense fallback={<CapsulePlaceholder />}>
              <CapsuleScene
                open={capsuleOpen}
                onToggle={() => setCapsuleOpen((value) => !value)}
                paused={!inView}
              />
            </Suspense>
          </div>
        </div>
      </div>
    </section>
  );
}
