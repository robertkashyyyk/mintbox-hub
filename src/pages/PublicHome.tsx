import { Link } from "react-router-dom";
import {
  ShieldCheck, Clock, Star, MapPin, Phone, Users, ArrowRight, CheckCircle2
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import heroImg from "@/assets/hero-warehouse.jpg";
import catBraking from "@/assets/cat-braking.jpg";
import catSuspension from "@/assets/cat-suspension.jpg";
import catFilters from "@/assets/cat-filters.jpg";
import catElectrical from "@/assets/cat-electrical.jpg";
import catEngine from "@/assets/cat-engine.jpg";
import catTransmission from "@/assets/cat-transmission.jpg";
import tradeImg from "@/assets/trade-workshop.jpg";

const categories = [
  { img: catBraking, label: "Braking", desc: "Discs, pads & hydraulics" },
  { img: catSuspension, label: "Suspension", desc: "Shocks, springs & arms" },
  { img: catFilters, label: "Filters", desc: "Oil, air, fuel & cabin" },
  { img: catElectrical, label: "Electrical", desc: "Batteries & alternators" },
  { img: catEngine, label: "Engine", desc: "Timing, gaskets & pumps" },
  { img: catTransmission, label: "Transmission", desc: "Clutches & driveshafts" },
];

const reasons = [
  { icon: ShieldCheck, title: "Local Stock", desc: "Parts available for same-day collection from our Coleraine counter." },
  { icon: Star, title: "Trade Pricing", desc: "Competitive pricing for garages, workshops and trade accounts." },
  { icon: Users, title: "Expert Knowledge", desc: "Real parts people who understand what you need — no scripts." },
  { icon: Clock, title: "Fast Action", desc: "Order today, collect today. No waiting around." },
];

const testimonials = [
  { quote: "PartsDoc always has what we need. Reliable service, every time.", author: "Local Garage, Coleraine", rating: 5 },
  { quote: "The trade pricing and fast turnaround keep us coming back.", author: "Workshop Owner, North Coast", rating: 5 },
  { quote: "Knowledgeable staff who actually know their parts.", author: "Independent Mechanic", rating: 5 },
];

const stats = [
  { value: "44+", label: "Brands Stocked" },
  { value: "250K+", label: "Parts Available" },
  { value: "Same Day", label: "Collection" },
  { value: "30+", label: "Years Experience" },
];

const PublicHome = () => (
  <div>
    {/* Hero — full-bleed image with gradient overlay */}
    <section className="relative min-h-[85vh] flex items-center overflow-hidden">
      <img
        src={heroImg}
        alt="PartsDoc warehouse"
        className="absolute inset-0 w-full h-full object-cover"
        width={1920}
        height={800}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-pd-charcoal via-pd-charcoal/90 to-pd-charcoal/40" />
      <div className="container mx-auto px-4 relative z-10 py-20">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-pd-accent/15 border border-pd-accent/30 text-pd-accent text-sm font-medium mb-6">
            <CheckCircle2 className="h-3.5 w-3.5" /> Coleraine, Northern Ireland
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground leading-[1.1] tracking-tight">
            Motor Parts.<br />
            Real Expertise.<br />
            <span className="text-pd-accent">Fast Action.</span>
          </h1>
          <p className="mt-6 text-lg md:text-xl text-foreground/80 max-w-lg leading-relaxed">
            Serving trade and retail customers with the right parts,
            practical advice and dependable service.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-4">
            <Button asChild size="lg" className="bg-pd-accent hover:bg-pd-accent-light text-foreground font-semibold text-base px-8 h-12 shadow-lg shadow-pd-accent/25">
              <Link to="/products">
                Browse Products <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outlineDark" className="text-base h-12 px-8">
              <Link to="/contact">Contact Us</Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Bottom stats strip */}
      <div className="absolute bottom-0 left-0 right-0 bg-pd-charcoal/80 backdrop-blur-md border-t border-foreground/10">
        <div className="container mx-auto px-4 py-5 grid grid-cols-2 md:grid-cols-4 gap-4">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-2xl font-bold text-pd-accent">{s.value}</div>
              <div className="text-xs text-foreground/70 uppercase tracking-wider mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* Category Tiles — image-based */}
    <section className="container mx-auto px-4 py-20">
      <div className="text-center mb-12">
        <p className="text-pd-accent text-sm font-semibold uppercase tracking-wider mb-2">What We Stock</p>
        <h2 className="text-3xl md:text-4xl font-bold text-pd-charcoal">Product Categories</h2>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {categories.map((c) => (
          <Link key={c.label} to="/products" className="group relative rounded-xl overflow-hidden aspect-square">
            <img
              src={c.img}
              alt={c.label}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
              loading="lazy"
              width={640}
              height={640}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-pd-charcoal via-pd-charcoal/30 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-5">
              <h3 className="text-lg font-bold text-foreground">{c.label}</h3>
              <p className="text-sm text-foreground/70 mt-0.5">{c.desc}</p>
              <div className="mt-3 inline-flex items-center gap-1 text-pd-accent text-sm font-medium opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300">
                View range <ArrowRight className="h-3.5 w-3.5" />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>

    {/* Why PartsDoc */}
    <section className="bg-pd-charcoal">
      <div className="container mx-auto px-4 py-20">
        <div className="text-center mb-14">
          <p className="text-pd-accent text-sm font-semibold uppercase tracking-wider mb-2">Why Choose Us</p>
          <h2 className="text-3xl md:text-4xl font-bold text-foreground">Built for the Trade. Open to Everyone.</h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {reasons.map((r) => (
            <div key={r.title} className="bg-pd-graphite rounded-xl p-6 border border-foreground/10 hover:border-pd-accent/30 transition-colors">
              <div className="w-12 h-12 rounded-lg bg-pd-accent/10 flex items-center justify-center text-pd-accent mb-5">
                <r.icon className="h-6 w-6" />
              </div>
              <h3 className="font-bold text-foreground mb-2">{r.title}</h3>
              <p className="text-sm text-foreground/70 leading-relaxed">{r.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* Trade Section — with image */}
    <section className="relative overflow-hidden">
      <img
        src={tradeImg}
        alt="Trade workshop"
        className="absolute inset-0 w-full h-full object-cover"
        loading="lazy"
        width={1280}
        height={640}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-pd-charcoal via-pd-charcoal/95 to-pd-charcoal/70" />
      <div className="container mx-auto px-4 py-20 md:py-24 relative z-10">
        <div className="max-w-xl">
          <p className="text-pd-accent text-sm font-semibold uppercase tracking-wider mb-3">For the Trade</p>
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-5">Trade &amp; Business Customers</h2>
          <p className="text-foreground/75 text-lg leading-relaxed mb-4">
            Competitive trade pricing, dedicated support, and reliable stock for garages,
            workshops and fleet operators across Northern Ireland.
          </p>
          <ul className="space-y-2 mb-8">
            {["Trade account pricing", "Same-day collection", "Dedicated parts support", "Hard-to-find sourcing"].map((item) => (
              <li key={item} className="flex items-center gap-2 text-foreground/80 text-sm">
                <CheckCircle2 className="h-4 w-4 text-pd-accent shrink-0" /> {item}
              </li>
            ))}
          </ul>
          <div className="flex flex-col sm:flex-row gap-3">
            <Button asChild size="lg" className="bg-pd-accent hover:bg-pd-accent-light text-foreground font-semibold">
              <Link to="/trade">Learn More <ArrowRight className="h-4 w-4 ml-1" /></Link>
            </Button>
            <Button asChild size="lg" variant="outlineDark">
              <Link to="/contact">Open a Trade Account</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>

    {/* Opening Hours Strip */}
    <section className="bg-pd-accent">
      <div className="container mx-auto px-4 py-5 flex flex-col md:flex-row items-center justify-center gap-4 md:gap-10 text-foreground">
        <div className="flex items-center gap-2 font-bold">
          <Clock className="h-5 w-5" /> Opening Hours
        </div>
        <span className="text-sm font-medium">Mon–Fri: 8:30 – 17:30</span>
        <span className="text-sm font-medium">Sat: 9:00 – 13:00</span>
        <span className="text-sm font-medium text-foreground/70">Sun: Closed</span>
      </div>
    </section>

    {/* Testimonials */}
    <section className="container mx-auto px-4 py-20">
      <div className="text-center mb-12">
        <p className="text-pd-accent text-sm font-semibold uppercase tracking-wider mb-2">Trusted</p>
        <h2 className="text-3xl md:text-4xl font-bold text-pd-charcoal">What Our Customers Say</h2>
      </div>
      <div className="grid md:grid-cols-3 gap-6">
        {testimonials.map((t, i) => (
          <Card key={i} className="bg-card border-pd-steel-light/30 shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-7">
              <div className="flex gap-0.5 text-pd-accent mb-4">
                {Array.from({ length: t.rating }).map((_, j) => (
                  <Star key={j} className="h-4 w-4 fill-current" />
                ))}
              </div>
              <p className="text-pd-charcoal leading-relaxed mb-5">"{t.quote}"</p>
              <p className="text-sm text-pd-steel font-medium">— {t.author}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>

    {/* Location with Map */}
    <section className="bg-pd-charcoal">
      <div className="container mx-auto px-4 py-20">
        <div className="grid md:grid-cols-2 gap-10 items-center">
          <div>
            <p className="text-pd-accent text-sm font-semibold uppercase tracking-wider mb-3">Find Us</p>
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-5">Visit Us in Coleraine</h2>
            <p className="text-foreground/75 mb-8 text-lg leading-relaxed">
              Our counter is open for trade and retail customers. Pop in for parts,
              advice, or to collect an order.
            </p>
            <ul className="space-y-4 text-sm">
              <li className="flex items-center gap-3 text-foreground/80">
                <div className="w-9 h-9 rounded-lg bg-pd-accent/10 flex items-center justify-center shrink-0">
                  <MapPin className="h-4 w-4 text-pd-accent" />
                </div>
                Coleraine, Co. Londonderry, Northern Ireland
              </li>
              <li className="flex items-center gap-3 text-foreground/80">
                <div className="w-9 h-9 rounded-lg bg-pd-accent/10 flex items-center justify-center shrink-0">
                  <Phone className="h-4 w-4 text-pd-accent" />
                </div>
                <a href="tel:+442870344344" className="hover:text-pd-accent transition-colors">028 7034 4344</a>
              </li>
            </ul>
            <Button asChild className="mt-8 bg-pd-accent hover:bg-pd-accent-light text-foreground font-semibold">
              <Link to="/contact">Get Directions &amp; Contact <ArrowRight className="h-4 w-4 ml-1" /></Link>
            </Button>
          </div>
          <div className="rounded-2xl overflow-hidden border border-foreground/10 h-72">
            <iframe
              src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d36168.81918201844!2d-6.6899!3d55.1326!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x486017b3cf11cc01%3A0xa9b1e11c5d5e3c0!2sColeraine!5e0!3m2!1sen!2suk!4v1700000000000!5m2!1sen!2suk"
              width="100%"
              height="100%"
              style={{ border: 0 }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title="PartsDoc Location - Coleraine"
            />
          </div>
        </div>
      </div>
    </section>
  </div>
);

export default PublicHome;
