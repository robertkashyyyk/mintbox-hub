import { useState, useEffect } from "react";
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
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-pd-charcoal/98 backdrop-blur-lg shadow-lg shadow-black/20"
          : "bg-pd-charcoal"
      }`}
    >
      <div className="container mx-auto px-4 flex items-center justify-between h-16 lg:h-18">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded bg-pd-accent flex items-center justify-center font-bold text-white text-sm">
            PD
          </div>
          <span className="text-xl font-bold text-white tracking-tight">
            Parts<span className="text-pd-accent">Doc</span>
          </span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden lg:flex items-center gap-8">
          {navLinks.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className={`text-sm font-medium tracking-wide uppercase transition-colors hover:text-pd-accent ${
                location.pathname === l.to ? "text-pd-accent" : "text-white/70"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        {/* Right actions */}
        <div className="hidden lg:flex items-center gap-4">
          <a
            href="tel:+442870344344"
            className="flex items-center gap-2 text-sm text-white/70 hover:text-white transition-colors"
          >
            <div className="w-8 h-8 rounded-full border border-white/20 flex items-center justify-center">
              <Phone className="h-3.5 w-3.5" />
            </div>
            028 7034 4344
          </a>
          <Button asChild className="bg-pd-accent hover:bg-pd-accent-light text-white font-semibold px-5">
            <Link to="/auth">
              <LogIn className="h-4 w-4 mr-1.5" />
              Hub Login
            </Link>
          </Button>
        </div>

        {/* Mobile toggle */}
        <button
          onClick={() => setOpen(!open)}
          className="lg:hidden text-white p-2"
          aria-label="Toggle menu"
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="lg:hidden bg-pd-charcoal/98 backdrop-blur-lg border-t border-white/5 pb-6 animate-in slide-in-from-top-2">
          <nav className="flex flex-col px-4 pt-2 gap-1">
            {navLinks.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                onClick={() => setOpen(false)}
                className={`py-3 text-sm font-medium uppercase tracking-wide border-b border-white/5 transition-colors ${
                  location.pathname === l.to ? "text-pd-accent" : "text-white/70"
                }`}
              >
                {l.label}
              </Link>
            ))}
            <a
              href="tel:+442870344344"
              className="py-3 text-sm text-white/70 flex items-center gap-2"
            >
              <Phone className="h-4 w-4" /> 028 7034 4344
            </a>
            <Button asChild className="mt-3 bg-pd-accent hover:bg-pd-accent-light text-white font-semibold">
              <Link to="/auth" onClick={() => setOpen(false)}>
                <LogIn className="h-4 w-4 mr-1.5" />
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
