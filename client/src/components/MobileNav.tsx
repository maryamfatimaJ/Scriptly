import { AnimatePresence, motion } from "framer-motion";
import { NavLink, useNavigate } from "react-router-dom";
import { CapsuleMotif } from "./CapsuleMotif";
import { Button } from "./Button";
import { useLogout } from "@/hooks/useAuth";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import type { User } from "@/types";

interface MobileNavProps {
  open: boolean;
  onClose: () => void;
  links: { to: string; label: string }[];
  user: User | null;
}

export function MobileNav({ open, onClose, links, user }: MobileNavProps) {
  const navigate = useNavigate();
  const logout = useLogout();
  const prefersReducedMotion = usePrefersReducedMotion();

  function go(path: string) {
    onClose();
    navigate(path);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-40 flex flex-col bg-forest text-offwhite md:hidden"
          initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: -12 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
        >
          <div className="flex items-center justify-between px-6 py-5">
            <CapsuleMotif className="h-6 w-14" />
            <button
              type="button"
              aria-label="Close menu"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-offwhite/30"
            >
              <span className="relative block h-4 w-4">
                <span className="absolute left-1/2 top-1/2 h-[1.5px] w-5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-offwhite" />
                <span className="absolute left-1/2 top-1/2 h-[1.5px] w-5 -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-offwhite" />
              </span>
            </button>
          </div>

          <nav className="flex flex-1 flex-col justify-center gap-6 px-8">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                onClick={onClose}
                className="font-display text-3xl"
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex flex-col gap-3 px-8 pb-10">
            {user ? (
              <Button variant="secondary" className="border-offwhite/40 text-offwhite" onClick={() => logout.mutate()}>
                Sign out
              </Button>
            ) : (
              <Button variant="secondary" className="border-offwhite/40 text-offwhite" onClick={() => go("/login")}>
                Sign in
              </Button>
            )}
            <Button className="bg-offwhite text-forest hover:bg-mint" onClick={() => go("/capture")}>
              Scan prescription
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
