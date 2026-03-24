import { Link } from "react-router-dom";
import { Phone, Mail, MapPin, Clock, LogIn } from "lucide-react";

const PublicFooter = () => (
  <footer className="bg-pd-charcoal text-white/70">
    {/* Pre-footer CTA */}
    <div className="bg-pd-graphite border-t border-white/10">
      <div className="container mx-auto px-4 py-12 text-center">
        <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">
          Need the right part?
        </h2>
        <p className="text-white/60 mb-6 max-w-lg mx-auto">
          Get in touch with our team — we'll help you find exactly what you need.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            to="/contact"
            className="inline-flex items-center justify-center px-6 py-3 bg-pd-amber text-pd-charcoal font-semibold rounded-md hover:bg-pd-amber/90 transition-colors"
          >
            Contact Us
          </Link>
          <a
            href="tel:+442870344344"
            className="inline-flex items-center justify-center px-6 py-3 border border-white/20 text-white font-medium rounded-md hover:bg-white/10 transition-colors"
          >
            <Phone className="h-4 w-4 mr-2" /> Call Now
          </a>
        </div>
      </div>
    </div>

    <div className="container mx-auto px-4 py-12 grid md:grid-cols-4 gap-8 text-sm">
      {/* Column 1 */}
      <div>
        <span className="text-xl font-bold text-white mb-4 block">
          Parts<span className="text-pd-amber">Doc</span>
        </span>
        <p className="leading-relaxed">
          Motor parts, accessories and real-world support from Coleraine, Northern Ireland.
        </p>
      </div>

      {/* Quick Links */}
      <div>
        <h4 className="text-white font-semibold mb-3">Quick Links</h4>
        <ul className="space-y-2">
          {[
            { label: "About", to: "/about" },
            { label: "Products", to: "/products" },
            { label: "Trade Customers", to: "/trade" },
            { label: "Contact Us", to: "/contact" },
            { label: "FAQ", to: "/faq" },
          ].map((l) => (
            <li key={l.to}>
              <Link to={l.to} className="hover:text-pd-amber transition-colors">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {/* Contact */}
      <div>
        <h4 className="text-white font-semibold mb-3">Contact</h4>
        <ul className="space-y-2">
          <li className="flex items-start gap-2">
            <MapPin className="h-4 w-4 mt-0.5 shrink-0" /> Coleraine, Co. Londonderry, Northern Ireland
          </li>
          <li className="flex items-center gap-2">
            <Phone className="h-4 w-4 shrink-0" />
            <a href="tel:+442870344344" className="hover:text-pd-amber transition-colors">028 7034 4344</a>
          </li>
          <li className="flex items-center gap-2">
            <Mail className="h-4 w-4 shrink-0" />
            <a href="mailto:sales@partsdoc.co.uk" className="hover:text-pd-amber transition-colors">sales@partsdoc.co.uk</a>
          </li>
        </ul>
      </div>

      {/* Hours */}
      <div>
        <h4 className="text-white font-semibold mb-3">Opening Hours</h4>
        <ul className="space-y-1">
          <li className="flex justify-between"><span>Mon – Fri</span><span className="text-white">8:30 – 17:30</span></li>
          <li className="flex justify-between"><span>Saturday</span><span className="text-white">9:00 – 13:00</span></li>
          <li className="flex justify-between"><span>Sunday</span><span className="text-white/50">Closed</span></li>
        </ul>
        <Link
          to="/auth"
          className="mt-4 inline-flex items-center gap-1.5 text-pd-amber hover:text-pd-amber/80 transition-colors font-medium"
        >
          <LogIn className="h-4 w-4" /> Hub Login
        </Link>
      </div>
    </div>

    <div className="border-t border-white/10 py-4">
      <div className="container mx-auto px-4 flex flex-col sm:flex-row justify-between items-center text-xs text-white/40">
        <span>© {new Date().getFullYear()} PartsDoc. All rights reserved.</span>
        <span className="mt-1 sm:mt-0">Coleraine, Northern Ireland</span>
      </div>
    </div>
  </footer>
);

export default PublicFooter;
