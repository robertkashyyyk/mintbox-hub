import { Link } from "react-router-dom";
import { Phone, Mail, MapPin, Clock, LogIn, ArrowRight } from "lucide-react";

const PublicFooter = () => (
  <footer className="bg-pd-charcoal text-white/60">
    {/* Pre-footer CTA */}
    <div className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-r from-pd-accent/20 to-pd-graphite" />
      <div className="container mx-auto px-4 py-16 relative text-center">
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-3">
          Need the right part?
        </h2>
        <p className="text-white/50 mb-8 max-w-lg mx-auto text-lg">
          Get in touch — we'll help you find exactly what you need, fast.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            to="/contact"
            className="inline-flex items-center justify-center gap-2 px-8 py-3.5 bg-pd-accent text-white font-semibold rounded-md hover:bg-pd-accent-light transition-colors"
          >
            Contact Us <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href="tel:+442870344344"
            className="inline-flex items-center justify-center gap-2 px-8 py-3.5 border border-white/20 text-white font-medium rounded-md hover:bg-white/10 transition-colors"
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
          <div className="w-7 h-7 rounded bg-pd-accent flex items-center justify-center font-bold text-white text-xs">
            PD
          </div>
          <span className="text-lg font-bold text-white">
            Parts<span className="text-pd-accent">Doc</span>
          </span>
        </div>
        <p className="leading-relaxed">
          Motor parts, accessories and real-world support from Coleraine, Northern Ireland.
        </p>
      </div>

      {/* Quick Links */}
      <div>
        <h4 className="text-white font-semibold mb-4 text-xs uppercase tracking-wider">Navigate</h4>
        <ul className="space-y-2.5">
          {[
            { label: "About", to: "/about" },
            { label: "Products", to: "/products" },
            { label: "Trade Customers", to: "/trade" },
            { label: "Contact Us", to: "/contact" },
            { label: "FAQ", to: "/faq" },
          ].map((l) => (
            <li key={l.to}>
              <Link to={l.to} className="hover:text-pd-accent transition-colors">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {/* Contact */}
      <div>
        <h4 className="text-white font-semibold mb-4 text-xs uppercase tracking-wider">Contact</h4>
        <ul className="space-y-2.5">
          <li className="flex items-start gap-2.5">
            <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-pd-accent" /> Coleraine, Co. Londonderry, Northern Ireland
          </li>
          <li className="flex items-center gap-2.5">
            <Phone className="h-4 w-4 shrink-0 text-pd-accent" />
            <a href="tel:+442870344344" className="hover:text-pd-accent transition-colors">028 7034 4344</a>
          </li>
          <li className="flex items-center gap-2.5">
            <Mail className="h-4 w-4 shrink-0 text-pd-accent" />
            <a href="mailto:sales@partsdoc.co.uk" className="hover:text-pd-accent transition-colors">sales@partsdoc.co.uk</a>
          </li>
        </ul>
      </div>

      {/* Hours */}
      <div>
        <h4 className="text-white font-semibold mb-4 text-xs uppercase tracking-wider">Opening Hours</h4>
        <ul className="space-y-2">
          <li className="flex justify-between"><span>Mon – Fri</span><span className="text-white">8:30 – 17:30</span></li>
          <li className="flex justify-between"><span>Saturday</span><span className="text-white">9:00 – 13:00</span></li>
          <li className="flex justify-between"><span>Sunday</span><span className="text-white/30">Closed</span></li>
        </ul>
        <Link
          to="/auth"
          className="mt-5 inline-flex items-center gap-2 text-pd-accent hover:text-pd-accent-light transition-colors font-medium text-sm"
        >
          <LogIn className="h-4 w-4" /> Hub Login
        </Link>
      </div>
    </div>

    <div className="border-t border-white/5 py-5">
      <div className="container mx-auto px-4 flex flex-col sm:flex-row justify-between items-center text-xs text-white/30">
        <span>© {new Date().getFullYear()} PartsDoc. All rights reserved.</span>
        <span className="mt-1 sm:mt-0">Coleraine, Northern Ireland</span>
      </div>
    </div>
  </footer>
);

export default PublicFooter;
