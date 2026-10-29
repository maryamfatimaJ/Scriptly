import { Outlet } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { ScriptyLauncher } from "@/components/scripty/ScriptyLauncher";

export function MainLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-offwhite text-charcoal">
      <Navbar />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <ScriptyLauncher />
    </div>
  );
}
