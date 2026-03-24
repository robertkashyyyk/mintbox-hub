import { Link } from "react-router-dom";
import {
  Disc3, Wrench, Filter, Zap, Car, Cog,
  ShieldCheck, Clock, Truck, Star, MapPin, Phone, Package, Users
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const categories = [
  { icon: Disc3, label: "Braking", desc: "Discs, pads, callipers & hydraulics" },
  { icon: Wrench, label: "Suspension", desc: "Shocks, springs, arms & bushes" },
  { icon: Filter, label: "Filters", desc: "Oil, air, fuel & cabin filters" },
  { icon: Zap, label: "Electrical", desc: "Batteries, alternators & starters" },
  { icon: Car, label: "Body & Trim", desc: "Panels, mirrors, lights & wipers" },
  { icon: Cog, label: "Engine Parts", desc: "Timing, gaskets, pumps & belts" },
  { icon: Truck, label: "Transmission", desc: "Clutches, CV joints & driveshafts" },
  { icon: Package, label: "Accessories", desc: "Oils, fluids, tools & car care" },
];

const reasons = [
  { icon: ShieldCheck, title: "Local Stock", desc: "Parts available for same-day collection from Coleraine." },
  { icon: Star, title: "Trade Pricing", desc: "Competitive pricing for garages, workshops and trade accounts." },
  { icon: Users, title: "Expert Knowledge", desc: "Real parts people who understand what you need." },
  { icon: Clock, title: "Fast Action", desc: "Order today, collect today — no waiting around." },
];

const testimonials = [
  { quote: "PartsDoc always has what we need. Reliable service, every time.", author: "Local Garage, Coleraine" },
  { quote: "The trade pricing and fast turnaround keep us coming back.", author: "Workshop Owner, North Coast" },
  { quote: "Knowledgeable staff who actually know their parts.", author: "Independent Mechanic" },
];

const PublicHome = () => (
  <div>
    {/* Hero */}
    <section className="bg-pd-charcoal relative overflow-hidden">
      <div className="absolute inset-0 opacity-5" style={{
        backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
        backgroundSize: "40px 40px",
      }} />
      <div className="container mx-auto px-4 py-20 md:py-28 relative">
        <div className="max-w-2xl">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight">
            Motor Parts.<br />
            Real Expertise.<br />
            <span className="text-pd-amber">Fast Action.</span>
          </h1>
          <p className="mt-6 text-lg text-white/60 max-w-lg">
            Serving trade and retail customers from Coleraine with the right parts,
            practical advice and dependable service.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <Button asChild size="lg" className="bg-pd-amber hover:bg-pd-amber/90 text-pd-charcoal font-semibold text-base">
              <Link to="/products">Browse Products</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-white/20 text-white hover:bg-white/10 text-base">
              <Link to="/contact">Contact Us</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>

    {/* Category Tiles */}
    <section className="container mx-auto px-4 py-16">
      <h2 className="text-2xl md:text-3xl font-bold text-pd-charcoal text-center mb-2">Product Categories</h2>
      <p className="text-pd-steel text-center mb-10 max-w-md mx-auto">
        We stock a wide range of parts and accessories across all major vehicle systems.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {categories.map((c) => (
          <Link key={c.label} to="/products">
            <Card className="group hover:shadow-md hover:border-pd-amber/40 transition-all duration-200 cursor-pointer h-full bg-white border-pd-steel/20">
              <CardContent className="p-5 flex flex-col items-center text-center">
                <div className="p-3 rounded-lg bg-pd-amber/10 text-pd-amber group-hover:bg-pd-amber group-hover:text-white transition-colors mb-3">
                  <c.icon className="h-6 w-6" />
                </div>
                <h3 className="font-semibold text-pd-charcoal text-sm">{c.label}</h3>
                <p className="text-xs text-pd-steel mt-1">{c.desc}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </section>

    {/* Why PartsDoc */}
    <section className="bg-white border-y border-pd-steel/10">
      <div className="container mx-auto px-4 py-16">
        <h2 className="text-2xl md:text-3xl font-bold text-pd-charcoal text-center mb-10">Why Choose PartsDoc?</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {reasons.map((r) => (
            <div key={r.title} className="text-center">
              <div className="inline-flex p-3 rounded-full bg-pd-amber/10 text-pd-amber mb-4">
                <r.icon className="h-6 w-6" />
              </div>
              <h3 className="font-semibold text-pd-charcoal mb-1">{r.title}</h3>
              <p className="text-sm text-pd-steel">{r.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* Trade Section */}
    <section className="bg-pd-graphite">
      <div className="container mx-auto px-4 py-16 md:py-20">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-4">Trade &amp; Business Customers</h2>
          <p className="text-white/60 mb-8 text-lg">
            Competitive trade pricing, dedicated support, and reliable stock for garages,
            workshops, and fleet operators across Northern Ireland.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" className="bg-pd-amber hover:bg-pd-amber/90 text-pd-charcoal font-semibold">
              <Link to="/trade">Learn More</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-white/20 text-white hover:bg-white/10">
              <Link to="/contact">Open a Trade Account</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>

    {/* Opening Hours Strip */}
    <section className="bg-pd-amber">
      <div className="container mx-auto px-4 py-5 flex flex-col md:flex-row items-center justify-center gap-4 md:gap-10 text-pd-charcoal">
        <div className="flex items-center gap-2 font-semibold">
          <Clock className="h-5 w-5" /> Opening Hours
        </div>
        <span className="text-sm font-medium">Mon–Fri: 8:30 – 17:30</span>
        <span className="text-sm font-medium">Sat: 9:00 – 13:00</span>
        <span className="text-sm font-medium opacity-60">Sun: Closed</span>
      </div>
    </section>

    {/* Testimonials */}
    <section className="container mx-auto px-4 py-16">
      <h2 className="text-2xl md:text-3xl font-bold text-pd-charcoal text-center mb-10">What Our Customers Say</h2>
      <div className="grid md:grid-cols-3 gap-6">
        {testimonials.map((t, i) => (
          <Card key={i} className="bg-white border-pd-steel/20">
            <CardContent className="p-6">
              <div className="flex gap-0.5 text-pd-amber mb-3">
                {Array.from({ length: 5 }).map((_, j) => (
                  <Star key={j} className="h-4 w-4 fill-current" />
                ))}
              </div>
              <p className="text-pd-charcoal italic mb-4">"{t.quote}"</p>
              <p className="text-sm text-pd-steel font-medium">— {t.author}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>

    {/* Location */}
    <section className="bg-white border-t border-pd-steel/10">
      <div className="container mx-auto px-4 py-16">
        <div className="grid md:grid-cols-2 gap-8 items-center">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-pd-charcoal mb-4">Visit Us in Coleraine</h2>
            <p className="text-pd-steel mb-6">
              Our counter is open for trade and retail customers. Pop in for parts, advice, or to collect an order.
            </p>
            <ul className="space-y-3 text-sm">
              <li className="flex items-center gap-2 text-pd-charcoal">
                <MapPin className="h-4 w-4 text-pd-amber shrink-0" /> Coleraine, Co. Londonderry, Northern Ireland
              </li>
              <li className="flex items-center gap-2 text-pd-charcoal">
                <Phone className="h-4 w-4 text-pd-amber shrink-0" />
                <a href="tel:+442870344344" className="hover:text-pd-amber transition-colors">028 7034 4344</a>
              </li>
            </ul>
            <Button asChild className="mt-6 bg-pd-amber hover:bg-pd-amber/90 text-pd-charcoal font-semibold">
              <Link to="/contact">Get Directions &amp; Contact</Link>
            </Button>
          </div>
          <div className="bg-pd-charcoal/5 rounded-lg h-64 flex items-center justify-center text-pd-steel">
            <div className="text-center">
              <MapPin className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <span className="text-sm">Map — Coleraine, NI</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
);

export default PublicHome;
