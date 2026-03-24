import { Link } from "react-router-dom";
import { ShieldCheck, Truck, Users, Clock, Phone, Wrench } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const benefits = [
  { icon: ShieldCheck, title: "Trade Pricing", desc: "Competitive rates for registered trade customers across all product lines." },
  { icon: Truck, title: "Reliable Stock", desc: "Deep inventory across major brands — less waiting, more working." },
  { icon: Users, title: "Dedicated Support", desc: "A team that knows your business and understands what you need." },
  { icon: Clock, title: "Fast Turnaround", desc: "Same-day collection and rapid order processing." },
  { icon: Wrench, title: "Parts Sourcing", desc: "If we don't have it, we'll find it. Specialist and hard-to-find parts sourced quickly." },
  { icon: Phone, title: "Easy Ordering", desc: "Phone, email, or counter — order however suits you best." },
];

const PublicTrade = () => (
  <div>
    <section className="bg-pd-charcoal py-16 md:py-20">
      <div className="container mx-auto px-4 text-center max-w-3xl">
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-4">Trade &amp; Business Customers</h1>
        <p className="text-white/60 text-lg">
          Garages, workshops, fleet operators and trade buyers — PartsDoc is built to support
          your business with competitive pricing, reliable stock and expert service.
        </p>
      </div>
    </section>

    <section className="container mx-auto px-4 py-16">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {benefits.map((b) => (
          <Card key={b.title} className="border-pd-steel/20 bg-white">
            <CardContent className="p-6">
              <div className="inline-flex p-2.5 rounded-lg bg-pd-amber/10 text-pd-amber mb-4">
                <b.icon className="h-5 w-5" />
              </div>
              <h3 className="font-semibold text-pd-charcoal mb-1">{b.title}</h3>
              <p className="text-sm text-pd-steel">{b.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>

    <section className="bg-pd-graphite">
      <div className="container mx-auto px-4 py-16 text-center max-w-2xl">
        <h2 className="text-2xl font-bold text-white mb-3">Open a Trade Account</h2>
        <p className="text-white/60 mb-6">
          Get in touch to discuss trade pricing, set up an account, or talk to our team about
          how we can support your workshop or business.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button asChild size="lg" className="bg-pd-amber hover:bg-pd-amber/90 text-pd-charcoal font-semibold">
            <Link to="/contact">Contact Us</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="border-white/20 text-white hover:bg-white/10">
            <a href="tel:+442870344344">Call Now</a>
          </Button>
        </div>
      </div>
    </section>
  </div>
);

export default PublicTrade;
