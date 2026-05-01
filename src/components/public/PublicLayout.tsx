import { Outlet } from "react-router-dom";
import PublicHeader from "./PublicHeader";
import PublicFooter from "./PublicFooter";
import { Phone } from "lucide-react";

const PublicLayout = () => (
  <div className="min-h-screen flex flex-col bg-pd-offwhite">
    <PublicHeader />
    <main className="flex-1">
      <Outlet />
    </main>
    <PublicFooter />

    {/* Mobile floating call button */}
    <a
      href="tel:+442870322970"
      className="lg:hidden fixed bottom-5 right-5 z-40 bg-pd-accent text-foreground p-3.5 rounded-full shadow-xl shadow-pd-accent/30 hover:bg-pd-accent-light transition-colors"
      aria-label="Call PartsDoc"
    >
      <Phone className="h-5 w-5" />
    </a>
  </div>
);

export default PublicLayout;
