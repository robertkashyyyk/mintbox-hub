import { Link } from "react-router-dom";
import {
  Disc3, Wrench, Filter, Zap, Car, Cog, Truck, Package,
  Thermometer, Droplets, Lightbulb, Gauge
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const categories = [
  { icon: Disc3, label: "Braking", desc: "Discs, pads, callipers, shoes, drums, hydraulics" },
  { icon: Wrench, label: "Suspension & Steering", desc: "Shocks, springs, arms, bushes, rack ends, ball joints" },
  { icon: Filter, label: "Filters", desc: "Oil, air, fuel, cabin and transmission filters" },
  { icon: Zap, label: "Electrical", desc: "Batteries, alternators, starters, sensors, ignition" },
  { icon: Car, label: "Body & Trim", desc: "Panels, mirrors, lights, wipers, weather strips" },
  { icon: Cog, label: "Engine", desc: "Timing kits, gaskets, water pumps, belts, chains" },
  { icon: Truck, label: "Transmission", desc: "Clutch kits, CV joints, driveshafts, mounts" },
  { icon: Thermometer, label: "Cooling & Heating", desc: "Radiators, thermostats, hoses, heater cores" },
  { icon: Droplets, label: "Oils & Fluids", desc: "Engine oil, brake fluid, coolant, transmission fluid" },
  { icon: Lightbulb, label: "Lighting", desc: "Headlamps, tail lights, indicators, bulbs" },
  { icon: Gauge, label: "Exhaust & Emission", desc: "Catalytic converters, DPFs, lambda sensors" },
  { icon: Package, label: "Accessories", desc: "Tools, car care, in-car tech, tow bars" },
];

const PublicProducts = () => (
  <div>
    <section className="bg-pd-charcoal py-16 md:py-20">
      <div className="container mx-auto px-4 text-center max-w-3xl">
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-4">Products &amp; Categories</h1>
        <p className="text-white/60 text-lg">
          Browse our range of motor parts and accessories. Need help finding the right part?
          Just ask — our team knows what fits.
        </p>
      </div>
    </section>

    <section className="container mx-auto px-4 py-16">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {categories.map((c) => (
          <Card key={c.label} className="group hover:shadow-md hover:border-pd-amber/40 transition-all duration-200 bg-white border-pd-steel/20">
            <CardContent className="p-5 flex flex-col items-center text-center">
              <div className="p-3 rounded-lg bg-pd-amber/10 text-pd-amber group-hover:bg-pd-amber group-hover:text-white transition-colors mb-3">
                <c.icon className="h-6 w-6" />
              </div>
              <h3 className="font-semibold text-pd-charcoal text-sm">{c.label}</h3>
              <p className="text-xs text-pd-steel mt-1">{c.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>

    {/* Help CTA */}
    <section className="bg-pd-graphite">
      <div className="container mx-auto px-4 py-16 text-center max-w-2xl">
        <h2 className="text-2xl font-bold text-white mb-3">Need Help Finding the Right Part?</h2>
        <p className="text-white/60 mb-6">
          Tell us your vehicle and what you need — we'll get back to you with availability and pricing.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button asChild size="lg" className="bg-pd-amber hover:bg-pd-amber/90 text-pd-charcoal font-semibold">
            <Link to="/contact">Send an Enquiry</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="border-white/20 text-white hover:bg-white/10">
            <a href="tel:+442870344344">Call Us</a>
          </Button>
        </div>
      </div>
    </section>
  </div>
);

export default PublicProducts;
