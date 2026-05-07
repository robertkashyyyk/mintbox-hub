import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import tradeImg from "@/assets/trade-workshop.jpg";

import imgPricing from "@/assets/trade-pricing.jpg";
import imgStock from "@/assets/trade-stock.jpg";
import imgSupport from "@/assets/trade-support.jpg";
import imgTurnaround from "@/assets/trade-turnaround.jpg";
import imgSourcing from "@/assets/trade-sourcing.jpg";
import imgOrdering from "@/assets/trade-ordering.jpg";

const benefits = [
  { img: imgPricing, title: "Trade Pricing", desc: "Competitive rates for registered trade customers across all product lines." },
  { img: imgStock, title: "Reliable Stock", desc: "Deep inventory across major brands — less waiting, more working." },
  { img: imgSupport, title: "Dedicated Support", desc: "A team that knows your business and understands what you need." },
  { img: imgTurnaround, title: "Fast Turnaround", desc: "Same-day collection and rapid order processing." },
  { img: imgSourcing, title: "Parts Sourcing", desc: "If we don't have it, we'll find it. Specialist and hard-to-find parts sourced quickly." },
  { img: imgOrdering, title: "Easy Ordering", desc: "Phone, email, or counter — order however suits you best." },
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
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {benefits.map((b) => (
          <div key={b.title} className="group relative rounded-xl overflow-hidden aspect-[4/3]">
            <img
              src={b.img}
              alt={b.title}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
              loading="lazy"
              width={800}
              height={600}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-pd-charcoal via-pd-charcoal/40 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-5">
              <h3 className="text-lg font-bold text-foreground">{b.title}</h3>
              <p className="text-sm text-foreground/75 mt-0.5 leading-relaxed">{b.desc}</p>
            </div>
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
