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
      href="tel:+442870344344"
      className="md:hidden fixed bottom-5 right-5 z-40 bg-pd-amber text-pd-charcoal p-3.5 rounded-full shadow-lg hover:bg-pd-amber/90 transition-colors"
      aria-label="Call PartsDoc"
    >
      <Phone className="h-5 w-5" />
    </a>
  </div>
);

export default PublicLayout;
