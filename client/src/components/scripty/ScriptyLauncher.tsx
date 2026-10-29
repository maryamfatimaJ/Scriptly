import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useAuth";
import { ScriptyChat } from "./ScriptyChat";

// Floating Scripty launcher, available on every authenticated page.
//
// Hidden for signed-out visitors: every one of Scripty's tools reads the
// user's own records, so offering it before sign-in would only produce
// 401s. The Review page embeds ScriptyChat inline instead, so the panel
// is suppressed there to avoid two Scriptys on one screen.

export function ScriptyLauncher() {
  const { data: user } = useCurrentUser();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  const suppressed = pathname.startsWith("/review/");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!user || suppressed) return null;

  return (
    <>
      {open && (
        <>
          {/* Backdrop sits in its own stacking context, outside any
              blurred ancestor — a `backdrop-blur` parent would otherwise
              become the containing block for these fixed children and
              trap the panel inside the header's box. */}
          <div
            className="fixed inset-0 z-40 bg-charcoal/20"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-label="Scripty assistant"
            className="fixed bottom-0 right-0 z-50 flex h-[min(80vh,640px)] w-full flex-col p-3 sm:bottom-6 sm:right-6 sm:w-[420px] sm:p-0"
          >
            <ScriptyChat
              className="shadow-2xl"
              onClose={() => setOpen(false)}
              greeting="Hi, I'm Scripty. I can explain your medicines, check prices in Pakistan, and help you set up reminders. What would you like help with?"
            />
          </div>
        </>
      )}

      {/* Hidden while the panel is open. Keeping it visible floated it
          over the panel's own footer and clipped the medical disclaimer —
          the single worst piece of text to obscure. Closing is handled by
          the header ×, the backdrop, and Escape. */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-label="Open Scripty, the medicine assistant"
          className="fixed bottom-5 right-5 z-50 flex h-14 items-center gap-2 rounded-capsule bg-forest px-5 text-offwhite shadow-lg transition hover:bg-charcoal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
        >
          <span className="text-base font-medium">Ask Scripty</span>
        </button>
      )}
    </>
  );
}
