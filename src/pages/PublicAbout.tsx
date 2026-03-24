import { ShieldCheck, Users, MapPin, Star } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const values = [
  { icon: ShieldCheck, title: "Dependable", desc: "We stock what we say we stock, and deliver on our promises." },
  { icon: Users, title: "Knowledgeable", desc: "Real parts people — not call-centre operators reading scripts." },
  { icon: MapPin, title: "Local", desc: "Rooted in Coleraine, serving the North Coast and beyond." },
  { icon: Star, title: "Modernising", desc: "Investing in systems and processes to serve you better, faster." },
];

const PublicAbout = () => (
  <div>
    <section className="bg-pd-charcoal py-16 md:py-20">
      <div className="container mx-auto px-4 max-w-3xl text-center">
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-4">About PartsDoc</h1>
        <p className="text-white/60 text-lg">
          A practical, dependable motor parts business based in Coleraine, Northern Ireland —
          supplying trade and retail customers with the right parts and real support.
        </p>
      </div>
    </section>

    <section className="container mx-auto px-4 py-16 max-w-3xl">
      <h2 className="text-2xl font-bold text-pd-charcoal mb-4">Our Story</h2>
      <div className="prose text-pd-steel max-w-none space-y-4 text-[15px] leading-relaxed">
        <p>
          PartsDoc has grown from a local motor factor into a trusted source of parts,
          accessories and practical support for customers across Northern Ireland.
        </p>
        <p>
          We work with garages, independent mechanics, fleet operators and everyday motorists —
          anyone who needs the right part, fast, with advice they can rely on. No waffle, no guessing.
        </p>
        <p>
          Based in Coleraine, we combine real-world counter service with modern inventory systems
          to keep stock levels accurate and orders moving quickly. We're investing in better tools
          and better processes so that our customers get a faster, smarter experience.
        </p>
      </div>
    </section>

    <section className="bg-white border-y border-pd-steel/10">
      <div className="container mx-auto px-4 py-16">
        <h2 className="text-2xl font-bold text-pd-charcoal text-center mb-10">What We Stand For</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {values.map((v) => (
            <Card key={v.title} className="border-pd-steel/20 bg-white">
              <CardContent className="p-6 text-center">
                <div className="inline-flex p-3 rounded-full bg-pd-amber/10 text-pd-amber mb-4">
                  <v.icon className="h-6 w-6" />
                </div>
                <h3 className="font-semibold text-pd-charcoal mb-1">{v.title}</h3>
                <p className="text-sm text-pd-steel">{v.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  </div>
);

export default PublicAbout;
