import { Link } from "react-router-dom";
import { ShieldCheck, Truck, Users, Clock, Phone, Wrench, ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import tradeImg from "@/assets/trade-workshop.jpg";

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
    <section className="relative min-h-[50vh] flex items-center">
      <img
        src={tradeImg}
        alt="Trade workshop"
        className="absolute inset-0 w-full h-full object-cover"
        width={1280}
        height={640}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-pd-charcoal via-pd-charcoal/95 to-pd-charcoal/70" />
      <div className="container mx-auto px-4 relative z-10 py-20 max-w-3xl text-center">
        <p className="text-pd-accent text-sm font-semibold uppercase tracking-wider mb-3">For the Trade</p>
        <h1 className="text-3xl md:text-5xl font-bold text-foreground mb-5">Trade &amp; Business Customers</h1>
        <p className="text-foreground/75 text-lg leading-relaxed">
          Garages, workshops, fleet operators and trade buyers — PartsDoc is built to support
          your business with competitive pricing, reliable stock and expert service.
        </p>
      </div>
    </section>

    <section className="container mx-auto px-4 py-20">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {benefits.map((b) => (
          <div key={b.title} className="bg-card rounded-xl p-6 border border-pd-steel-light/20 hover:border-pd-accent/30 hover:shadow-md transition-all">
            <div className="w-11 h-11 rounded-lg bg-pd-accent/10 flex items-center justify-center text-pd-accent mb-4">
              <b.icon className="h-5 w-5" />
            </div>
            <h3 className="font-bold text-pd-charcoal mb-1.5">{b.title}</h3>
            <p className="text-sm text-pd-charcoal/70 leading-relaxed">{b.desc}</p>
          </div>
        ))}
      </div>
    </section>

    <section className="bg-pd-charcoal">
      <div className="container mx-auto px-4 py-20 text-center max-w-2xl">
        <h2 className="text-3xl font-bold text-foreground mb-4">Open a Trade Account</h2>
        <p className="text-foreground/70 mb-8 text-lg">
          Get in touch to discuss trade pricing, set up an account, or talk to our team about
          how we can support your workshop or business.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button asChild size="lg" className="bg-pd-accent hover:bg-pd-accent-light text-foreground font-semibold">
            <Link to="/contact">Contact Us <ArrowRight className="h-4 w-4 ml-1" /></Link>
          </Button>
            <Button asChild size="lg" variant="outlineDark">
              <a href="tel:+442870322970">Call Now</a>
            </Button>
        </div>
      </div>
    </section>
  </div>
);

export default PublicTrade;
