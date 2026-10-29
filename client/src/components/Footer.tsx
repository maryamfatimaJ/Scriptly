import { NavLink } from "react-router-dom";
import { CapsuleMotif } from "./CapsuleMotif";
import { Disclaimer } from "./Disclaimer";

export function Footer() {
  return (
    <footer className="border-t border-charcoal/10 bg-offwhite">
      {/* Three columns only from `lg`. At `sm` (640px) the middle column
          was ~164px wide while "Medicine information" alone needs 140px,
          so all three links stacked on separate rows — worse than the
          wrapping row it replaced. Below `lg` it is a simple stack. */}
      <div className="mx-auto grid max-w-content gap-6 px-6 py-10 lg:grid-cols-[auto_1fr_auto] lg:items-center lg:gap-10">
        <div className="flex items-center gap-3">
          <CapsuleMotif className="h-5 w-12" />
          <span className="font-display text-base">Scriptly</span>
        </div>

        <nav className="flex flex-wrap gap-x-6 gap-y-2 t-nav text-charcoal/70 lg:justify-center">
          <NavLink to="/how-it-works" className="hover:text-charcoal">
            How it works
          </NavLink>
          <NavLink to="/medicines" className="hover:text-charcoal">
            Medicine information
          </NavLink>
          <NavLink to="/login" className="hover:text-charcoal">
            Account
          </NavLink>
        </nav>

        <Disclaimer className="t-meta lg:text-right" />
      </div>
    </footer>
  );
}
