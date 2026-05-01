import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const faqs = [
  { q: "Do you supply trade and retail customers?", a: "Yes. We supply both trade and retail customers. If you're a garage, workshop or fleet operator, ask us about trade pricing and opening a trade account." },
  { q: "Can I collect parts from your counter?", a: "Absolutely. Our Coleraine counter is open Monday to Friday 8:30–17:30 and Saturday 9:00–13:00. Many orders can be collected same-day." },
  { q: "How do I find the right part for my vehicle?", a: "Call us on 028 7032 2970 or email sales@partsdoc.co.uk with your vehicle registration and what you need. We'll confirm fitment and availability." },
  { q: "Do you deliver?", a: "We offer delivery options depending on your location and order. Contact us to discuss delivery for your specific order." },
  { q: "What brands do you stock?", a: "We stock parts from a wide range of leading aftermarket brands across all vehicle systems — braking, suspension, engine, electrical and more." },
  { q: "What is the Hub Login?", a: "The Hub is our internal system for account users and staff. If you have been given login credentials, you can access the Hub via the login button in the header." },
  { q: "Can you source hard-to-find parts?", a: "Yes. If it's not in our standard stock, we can usually source it. Let us know what you need and we'll do our best to track it down." },
];

const PublicFAQ = () => (
  <div>
    <section className="bg-pd-charcoal py-20 md:py-24">
      <div className="container mx-auto px-4 text-center max-w-3xl">
        <p className="text-pd-accent text-sm font-semibold uppercase tracking-wider mb-3">Support</p>
        <h1 className="text-3xl md:text-5xl font-bold text-foreground mb-5">Frequently Asked Questions</h1>
        <p className="text-foreground/50 text-lg leading-relaxed">
          Common questions about our products, services and how to work with us.
        </p>
      </div>
    </section>

    <section className="container mx-auto px-4 py-20 max-w-2xl">
      <Accordion type="single" collapsible className="space-y-3">
        {faqs.map((f, i) => (
          <AccordionItem
            key={i}
            value={`faq-${i}`}
            className="border border-pd-steel-light/20 rounded-xl bg-card px-5 data-[state=open]:border-pd-accent/30 transition-colors"
          >
            <AccordionTrigger className="text-pd-charcoal font-medium text-left hover:no-underline py-5">
              {f.q}
            </AccordionTrigger>
            <AccordionContent className="text-pd-steel text-sm pb-5 leading-relaxed">
              {f.a}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  </div>
);

export default PublicFAQ;
