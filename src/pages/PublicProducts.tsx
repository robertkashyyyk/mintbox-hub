import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

import catBraking from "@/assets/cat-braking.jpg";
import catSuspension from "@/assets/cat-suspension.jpg";
import catFilters from "@/assets/cat-filters.jpg";
import catElectrical from "@/assets/cat-electrical.jpg";
import catEngine from "@/assets/cat-engine.jpg";
import catTransmission from "@/assets/cat-transmission.jpg";

const categories = [
  { img: catBraking, label: "Braking", desc: "Discs, pads, callipers, shoes, drums, hydraulics" },
  { img: catSuspension, label: "Suspension & Steering", desc: "Shocks, springs, arms, bushes, rack ends, ball joints" },
  { img: catFilters, label: "Filters", desc: "Oil, air, fuel, cabin and transmission filters" },
  { img: catElectrical, label: "Electrical", desc: "Batteries, alternators, starters, sensors, ignition" },
  { img: catEngine, label: "Engine", desc: "Timing kits, gaskets, water pumps, belts, chains" },
  { img: catTransmission, label: "Transmission", desc: "Clutch kits, CV joints, driveshafts, mounts" },
];

const PublicProducts = () => (
  <div>
    <section className="bg-pd-charcoal py-20 md:py-24">
      <div className="container mx-auto px-4 text-center max-w-3xl">
        <p className="text-pd-accent text-sm font-semibold uppercase tracking-wider mb-3">Our Range</p>
        <h1 className="text-3xl md:text-5xl font-bold text-white mb-5">Products &amp; Categories</h1>
        <p className="text-white/75 text-lg leading-relaxed">
          Browse our range of motor parts and accessories. Need help finding the right part?
          Just ask — our team knows what fits.
        </p>
      </div>
    </section>

    <section className="container mx-auto px-4 py-20">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {categories.map((c) => (
          <div key={c.label} className="group relative rounded-xl overflow-hidden aspect-[4/3]">
            <img
              src={c.img}
              alt={c.label}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
              loading="lazy"
              width={640}
              height={640}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-pd-charcoal via-pd-charcoal/40 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-5">
              <h3 className="text-lg font-bold text-white">{c.label}</h3>
              <p className="text-sm text-white/70 mt-0.5">{c.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>

    {/* Help CTA */}
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-r from-pd-accent/20 to-pd-charcoal" />
      <div className="absolute inset-0 bg-pd-charcoal/90" />
      <div className="container mx-auto px-4 py-20 text-center max-w-2xl relative z-10">
        <h2 className="text-3xl font-bold text-white mb-4">Need Help Finding the Right Part?</h2>
        <p className="text-white/70 mb-8 text-lg">
          Tell us your vehicle and what you need — we'll get back to you with availability and pricing.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button asChild size="lg" className="bg-pd-accent hover:bg-pd-accent-light text-white font-semibold">
            <Link to="/contact">Send an Enquiry <ArrowRight className="h-4 w-4 ml-1" /></Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10">
            <a href="tel:+442870344344">Call Us</a>
          </Button>
        </div>
      </div>
    </section>
  </div>
);

export default PublicProducts;
