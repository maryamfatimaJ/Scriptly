import type { Config } from "tailwindcss";

// Brand system — "the capsule": two contrasting halves, clinical and calm.
//
// The palette is derived from the 3D capsule in the homepage hero
// (src/components/hero/CapsuleScene.tsx), so the page and its one big
// object share a light: the capsule's blue half is #178ce2, its white
// half #f3f8fc, its rim light #68c3ff and its contact shadow #1d5d88.
//
// A NOTE ON THE TOKEN NAMES. They are historical — "forest", "mint" and
// "sage" date from an earlier green identity and are now blues. They were
// kept rather than renamed because they are referenced ~400 times across
// the app, and a mass rename of Tailwind class strings risks silently
// unstyling whatever it misses, for no visual gain. Read them as ROLES,
// not hues:
//     forest   primary       buttons, links, the dark panel
//     mint     wash          soft tinted surfaces
//     sage     accent        muted mid-tone, numerals, capsule trail
//     offwhite surface       the page itself
//     charcoal ink           body text
//     gray     muted         secondary text
//
// The hex values themselves now live in src/styles/index.css (:root).
// Every pairing was contrast-checked: the lowest is muted-on-wash at
// 4.65:1, which clears WCAG AA. Changing a value means re-checking that.
//
// Keep this palette the single source of truth; components should
// reference these tokens (bg-forest, text-charcoal, etc.) rather than raw
// hex values so the identity stays consistent across every page.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Values live in src/styles/index.css (:root) as RGB channels, so
      // the hero stylesheet and the SVG mark can read the same tokens.
      // `<alpha-value>` keeps opacity modifiers (bg-forest/40) working.
      colors: {
        forest: "rgb(var(--sc-primary) / <alpha-value>)",
        offwhite: "rgb(var(--sc-surface) / <alpha-value>)",
        sage: "rgb(var(--sc-accent) / <alpha-value>)",
        mint: "rgb(var(--sc-wash) / <alpha-value>)",
        charcoal: "rgb(var(--sc-ink) / <alpha-value>)",
        gray: "rgb(var(--sc-muted) / <alpha-value>)",
      },
      fontFamily: {
        // One family throughout. Geist is a geometric grotesque with a
        // wide weight range, so hierarchy comes from size, weight and
        // tracking rather than from mixing a serif with a sans — which
        // is how the reference composition reads. `serif` is kept as a
        // key only so any lingering `font-serif` utility resolves to the
        // same family instead of falling back to Times.
        sans: ["var(--sc-font-sans)"],
        serif: ["var(--sc-font-sans)"],
      },
      maxWidth: {
        content: "1240px",
      },
      borderRadius: {
        capsule: "999px",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.6s ease-out both",
      },
    },
  },
  plugins: [],
} satisfies Config;
