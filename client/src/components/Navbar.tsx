import { Fragment, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { cn } from "@/lib/cn";
import { CapsuleMotif } from "./CapsuleMotif";
import { Button } from "./Button";
import { MobileNav } from "./MobileNav";
import { useCurrentUser, useLogout } from "@/hooks/useAuth";

// Navigation is split by who is actually looking at it.
//
// Previously every visitor saw all five links, so a signed-out person was
// offered "My medications", "Schedule" and "History" — three links that
// can only bounce them to the login screen. Showing a signed-out visitor
// the marketing links and a signed-in one their own app is both shorter
// and more honest about what each link does.
//
// The full list still goes to MobileNav, which handles its own signed-out
// state, so nothing becomes unreachable on a phone.

const PUBLIC_LINKS = [
  { to: "/how-it-works", label: "How it works" },
  { to: "/medicines", label: "Medicine info" },
];

const APP_LINKS = [
  { to: "/medications", label: "My medications" },
  { to: "/schedule", label: "Schedule" },
  { to: "/history", label: "History" },
  { to: "/medicines", label: "Medicine info" },
];

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: user } = useCurrentUser();
  const logout = useLogout();
  const navigate = useNavigate();

  const links = user ? APP_LINKS : PUBLIC_LINKS;
  // The drawer has room for more than the top bar, so a signed-in user
  // keeps "How it works" there rather than losing it entirely.
  const mobileLinks = user ? [...APP_LINKS, { to: "/how-it-works", label: "How it works" }] : PUBLIC_LINKS;

  return (
    <Fragment>
      {/* `backdrop-blur` (CSS backdrop-filter) establishes a new containing
          block for `position: fixed` descendants — so MobileNav's
          full-screen overlay must live outside this header, not inside it,
          or it ends up sized to the header's own height instead of the
          viewport. */}
      {/* Opaque, not translucent. At 85% + blur the dark "Your routine"
          section read straight through the sticky bar — you could read
          the heading and the white card through the chrome. Because the
          header colour is the same offwhite as the page, going opaque is
          invisible over light sections and cleanly occludes the dark one,
          so no border is needed either. */}
      <header className="sticky top-0 z-30 bg-offwhite">
        <div className="mx-auto flex max-w-content items-center justify-between gap-8 px-6 py-5">
          <NavLink to="/" className="flex shrink-0 items-center gap-2.5" aria-label="Scriptly home">
            <CapsuleMotif className="h-[1.1rem] w-10" />
            <span className="font-display text-[1.0625rem] font-medium tracking-[-0.02em]">Scriptly</span>
          </NavLink>

          <nav className="hidden items-center gap-7 md:flex">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  cn(
                    "t-nav transition-colors",
                    isActive ? "text-charcoal" : "text-charcoal/75 hover:text-charcoal"
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="hidden shrink-0 items-center gap-6 md:flex">
            {user ? (
              <>
                <NavLink to="/account" className="t-nav text-charcoal/75 transition-colors hover:text-charcoal">
                  {user.fullName.split(" ")[0]}
                </NavLink>
                <button
                  type="button"
                  onClick={() => logout.mutate()}
                  className="t-nav text-charcoal/75 transition-colors hover:text-charcoal"
                >
                  Sign out
                </button>
              </>
            ) : (
              <NavLink to="/login" className="t-nav text-charcoal/75 transition-colors hover:text-charcoal">
                Sign in
              </NavLink>
            )}
            <Button className="px-5 py-2.5" onClick={() => navigate("/capture")}>
              Scan prescription
            </Button>
          </div>

          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-charcoal/15 md:hidden"
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)}
          >
            <span className="relative block h-3 w-5">
              <span className="absolute inset-x-0 top-0 h-[1.5px] bg-charcoal" />
              <span className="absolute inset-x-0 bottom-0 h-[1.5px] bg-charcoal" />
            </span>
          </button>
        </div>
      </header>

      <MobileNav open={mobileOpen} onClose={() => setMobileOpen(false)} links={mobileLinks} user={user ?? null} />
    </Fragment>
  );
}
