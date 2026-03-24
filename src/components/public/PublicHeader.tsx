import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X, Phone, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";

const navLinks = [
  { label: "About", to: "/about" },
  { label: "Products", to: "/products" },
  { label: "Trade", to: "/trade" },
  { label: "Contact", to: "/contact" },
  { label: "FAQ", to: "/faq" },
];

const PublicHeader = () => {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  return (
    <header className="sticky top-0 z-50 bg-pd-charcoal/95 backdrop-blur-md border-b border-white/10">
      <div className="container mx-auto px-4 flex items-center justify-between h-16">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2">
          <span className="text-2xl font-bold text-white tracking-tight">
            Parts<span className="text-pd-amber">Doc</span>
          </span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-6">
          {navLinks.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className={`text-sm font-medium transition-colors hover:text-pd-amber ${
                location.pathname === l.to ? "text-pd-amber" : "text-white/80"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        {/* Right actions */}
        <div className="hidden md:flex items-center gap-3">
          <a
            href="tel:+442870344344"
            className="flex items-center gap-1.5 text-sm text-white/80 hover:text-white transition-colors"
          >
            <Phone className="h-4 w-4" />
            028 7034 4344
          </a>
          <Button asChild className="bg-pd-amber hover:bg-pd-amber/90 text-pd-charcoal font-semibold">
            <Link to="/auth">
              <LogIn className="h-4 w-4 mr-1" />
              Hub Login
            </Link>
          </Button>
        </div>

        {/* Mobile toggle */}
        <button
          onClick={() => setOpen(!open)}
          className="md:hidden text-white p-2"
          aria-label="Toggle menu"
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden bg-pd-charcoal border-t border-white/10 pb-4">
          <nav className="flex flex-col px-4 pt-2 gap-1">
            {navLinks.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                onClick={() => setOpen(false)}
                className={`py-2.5 text-sm font-medium transition-colors ${
                  location.pathname === l.to ? "text-pd-amber" : "text-white/80"
                }`}
              >
                {l.label}
              </Link>
            ))}
            <a
              href="tel:+442870344344"
              className="py-2.5 text-sm text-white/80 flex items-center gap-1.5"
            >
              <Phone className="h-4 w-4" /> 028 7034 4344
            </a>
            <Button asChild className="mt-2 bg-pd-amber hover:bg-pd-amber/90 text-pd-charcoal font-semibold">
              <Link to="/auth" onClick={() => setOpen(false)}>
                <LogIn className="h-4 w-4 mr-1" />
                Hub Login
              </Link>
            </Button>
          </nav>
        </div>
      )}
    </header>
  );
};

export default PublicHeader;
