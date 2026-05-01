import { Link } from "react-router-dom";
import { Phone, Mail, MapPin, Clock, LogIn, ArrowRight } from "lucide-react";

const PublicFooter = () => (
  <footer className="bg-pd-charcoal text-foreground/70">
    {/* Pre-footer CTA */}
    <div className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-r from-pd-accent/20 to-pd-graphite" />
      <div className="container mx-auto px-4 py-16 relative text-center">
        <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-3">
          Need the right part?
        </h2>
        <p className="text-foreground/70 mb-8 max-w-lg mx-auto text-lg">
          Get in touch — we'll help you find exactly what you need, fast.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            to="/contact"
            className="inline-flex items-center justify-center gap-2 px-8 py-3.5 bg-pd-accent text-foreground font-semibold rounded-md hover:bg-pd-accent-light transition-colors"
          >
            Contact Us <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href="tel:+442870322970"
            className="inline-flex items-center justify-center gap-2 px-8 py-3.5 border border-foreground/30 text-foreground font-medium rounded-md hover:bg-foreground/10 transition-colors"
          >
            <Phone className="h-4 w-4" /> Call Now
          </a>
        </div>
      </div>
    </div>

    <div className="container mx-auto px-4 py-14 grid md:grid-cols-4 gap-10 text-sm">
      {/* Column 1 */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded bg-pd-accent flex items-center justify-center font-bold text-foreground text-xs">
            PD
          </div>
          <span className="text-lg font-bold text-foreground">
            Parts<span className="text-pd-accent">Doc</span>
          </span>
        </div>
        <p className="leading-relaxed text-foreground/70">
          Motor parts, accessories and real-world support from Coleraine, Northern Ireland.
        </p>
      </div>

      {/* Quick Links */}
      <div>
        <h4 className="text-foreground font-semibold mb-4 text-xs uppercase tracking-wider">Navigate</h4>
        <ul className="space-y-2.5">
          {[
            { label: "About", to: "/about" },
            { label: "Products", to: "/products" },
            { label: "Trade Customers", to: "/trade" },
            { label: "Contact Us", to: "/contact" },
            { label: "FAQ", to: "/faq" },
          ].map((l) => (
            <li key={l.to}>
              <Link to={l.to} className="text-foreground/70 hover:text-pd-accent transition-colors">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {/* Contact */}
      <div>
        <h4 className="text-foreground font-semibold mb-4 text-xs uppercase tracking-wider">Contact</h4>
        <ul className="space-y-2.5">
          <li className="flex items-start gap-2.5">
            <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-pd-accent" />
            <span className="text-foreground/70">Coleraine, Co. Londonderry, Northern Ireland</span>
          </li>
          <li className="flex items-center gap-2.5">
            <Phone className="h-4 w-4 shrink-0 text-pd-accent" />
            <a href="tel:+442870322970" className="text-foreground/70 hover:text-pd-accent transition-colors">028 7032 2970</a>
          </li>
          <li className="flex items-center gap-2.5">
            <Mail className="h-4 w-4 shrink-0 text-pd-accent" />
            <a href="mailto:sales@partsdoc.co.uk" className="text-foreground/70 hover:text-pd-accent transition-colors">sales@partsdoc.co.uk</a>
          </li>
        </ul>
      </div>

      {/* Hours */}
      <div>
        <h4 className="text-foreground font-semibold mb-4 text-xs uppercase tracking-wider">Opening Hours</h4>
        <ul className="space-y-2">
          <li className="flex justify-between"><span className="text-foreground/70">Mon – Fri</span><span className="text-foreground">8:30 – 17:30</span></li>
          <li className="flex justify-between"><span className="text-foreground/70">Saturday</span><span className="text-foreground">9:00 – 13:00</span></li>
          <li className="flex justify-between"><span className="text-foreground/50">Sunday</span><span className="text-foreground/50">Closed</span></li>
        </ul>
        <Link
          to="/auth"
          className="mt-5 inline-flex items-center gap-2 text-pd-accent hover:text-pd-accent-light transition-colors font-medium text-sm"
        >
          <LogIn className="h-4 w-4" /> Hub Login
        </Link>
      </div>
    </div>

    <div className="border-t border-foreground/10 py-5">
      <div className="container mx-auto px-4 flex flex-col sm:flex-row justify-between items-center text-xs text-foreground/50">
        <span>© {new Date().getFullYear()} PartsDoc. All rights reserved.</span>
        <span className="mt-1 sm:mt-0">Coleraine, Northern Ireland</span>
      </div>
    </div>
  </footer>
);

export default PublicFooter;
