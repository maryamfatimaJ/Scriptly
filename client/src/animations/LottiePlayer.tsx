import Lottie from "lottie-react";

// Split into its own module purely so `lottie-react` can be code-split.
//
// CapsuleIntro imports this lazily. When it was imported statically,
// lottie-web landed in the critical-path bundle (~253KB gzipped) on every
// single page load — even though the shipped asset is a GIF and no Lottie
// JSON exists in the project at all. That cost was paid by every visitor
// to support a fallback almost none of them would ever hit.

export default function LottiePlayer({ data, onComplete }: { data: object; onComplete: () => void }) {
  return (
    <div className="h-48 w-48 sm:h-64 sm:w-64">
      <Lottie
        animationData={data}
        loop={false}
        autoplay
        onComplete={onComplete}
        rendererSettings={{ preserveAspectRatio: "xMidYMid meet" }}
        aria-label="Capsule opening animation"
      />
    </div>
  );
}
