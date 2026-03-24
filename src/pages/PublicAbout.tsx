import { ShieldCheck, Users, MapPin, Star, CheckCircle2 } from "lucide-react";

const values = [
  { icon: ShieldCheck, title: "Dependable", desc: "We stock what we say we stock, and deliver on our promises." },
  { icon: Users, title: "Knowledgeable", desc: "Real parts people — not call-centre operators reading scripts." },
  { icon: MapPin, title: "Local", desc: "Rooted in Coleraine, serving the North Coast and beyond." },
  { icon: Star, title: "Modernising", desc: "Investing in systems and processes to serve you better, faster." },
];

const PublicAbout = () => (
  <div>
    <section className="bg-pd-charcoal py-20 md:py-24">
      <div className="container mx-auto px-4 max-w-3xl text-center">
        <p className="text-pd-accent text-sm font-semibold uppercase tracking-wider mb-3">Our Story</p>
        <h1 className="text-3xl md:text-5xl font-bold text-white mb-5">About PartsDoc</h1>
        <p className="text-white/50 text-lg leading-relaxed">
          A practical, dependable motor parts business based in Coleraine, Northern Ireland —
          supplying trade and retail customers with the right parts and real support.
        </p>
      </div>
    </section>

    <section className="container mx-auto px-4 py-20 max-w-3xl">
      <div className="space-y-6 text-[15px] text-pd-steel leading-relaxed">
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

    <section className="bg-pd-charcoal">
      <div className="container mx-auto px-4 py-20">
        <div className="text-center mb-14">
          <p className="text-pd-accent text-sm font-semibold uppercase tracking-wider mb-2">Our Values</p>
          <h2 className="text-3xl font-bold text-white">What We Stand For</h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {values.map((v) => (
            <div key={v.title} className="bg-pd-graphite rounded-xl p-6 border border-white/5">
              <div className="w-12 h-12 rounded-lg bg-pd-accent/10 flex items-center justify-center text-pd-accent mb-5">
                <v.icon className="h-6 w-6" />
              </div>
              <h3 className="font-bold text-white mb-2">{v.title}</h3>
              <p className="text-sm text-white/50 leading-relaxed">{v.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  </div>
);

export default PublicAbout;
