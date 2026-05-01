import { Phone, Mail, MapPin, Clock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

const PublicContact = () => (
  <div>
    <section className="bg-pd-charcoal py-20 md:py-24">
      <div className="container mx-auto px-4 text-center max-w-3xl">
        <p className="text-pd-accent text-sm font-semibold uppercase tracking-wider mb-3">Get in Touch</p>
        <h1 className="text-3xl md:text-5xl font-bold text-foreground mb-5">Contact Us</h1>
        <p className="text-foreground/75 text-lg leading-relaxed">
          Get in touch by phone, email, or visit our counter in Coleraine. We're here to help.
        </p>
      </div>
    </section>

    <section className="container mx-auto px-4 py-20">
      <div className="grid lg:grid-cols-2 gap-12">
        {/* Contact Info */}
        <div className="space-y-6">
          <div className="bg-pd-offwhite rounded-xl p-7 border border-pd-steel-light/20">
            <h2 className="text-lg font-bold text-pd-charcoal mb-5">Get in Touch</h2>
            <div className="space-y-4 text-sm">
              <a href="tel:+442870322970" className="flex items-center gap-4 group">
                <div className="w-10 h-10 rounded-lg bg-pd-accent/10 flex items-center justify-center shrink-0">
                  <Phone className="h-4 w-4 text-pd-accent" />
                </div>
                <div>
                  <div className="text-xs text-pd-steel-light uppercase tracking-wider">Phone</div>
                  <div className="text-pd-charcoal font-medium group-hover:text-pd-accent transition-colors">028 7032 2970</div>
                </div>
              </a>
              <a href="mailto:sales@partsdoc.co.uk" className="flex items-center gap-4 group">
                <div className="w-10 h-10 rounded-lg bg-pd-accent/10 flex items-center justify-center shrink-0">
                  <Mail className="h-4 w-4 text-pd-accent" />
                </div>
                <div>
                  <div className="text-xs text-pd-steel-light uppercase tracking-wider">Email</div>
                  <div className="text-pd-charcoal font-medium group-hover:text-pd-accent transition-colors">sales@partsdoc.co.uk</div>
                </div>
              </a>
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-pd-accent/10 flex items-center justify-center shrink-0">
                  <MapPin className="h-4 w-4 text-pd-accent" />
                </div>
                <div>
                  <div className="text-xs text-pd-steel-light uppercase tracking-wider">Location</div>
                  <div className="text-pd-charcoal font-medium">Coleraine, Co. Londonderry, BT52 2NS</div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-pd-offwhite rounded-xl p-7 border border-pd-steel-light/20">
            <h2 className="text-lg font-bold text-pd-charcoal mb-4 flex items-center gap-2">
              <Clock className="h-4 w-4 text-pd-accent" /> Opening Hours
            </h2>
            <ul className="space-y-3 text-sm">
              <li className="flex justify-between text-pd-charcoal py-2 border-b border-pd-steel-light/10">
                <span>Monday – Friday</span><span className="font-semibold">8:30 – 17:30</span>
              </li>
              <li className="flex justify-between text-pd-charcoal py-2 border-b border-pd-steel-light/10">
                <span>Saturday</span><span className="font-semibold">9:00 – 13:00</span>
              </li>
              <li className="flex justify-between py-2">
                <span className="text-pd-charcoal">Sunday</span><span className="text-pd-steel-light">Closed</span>
              </li>
            </ul>
          </div>

          {/* Embedded Map */}
          <div className="rounded-xl overflow-hidden border border-pd-steel-light/20 h-52">
            <iframe
              src="https://www.google.com/maps?q=PartsDoc+BT52+2NS+Coleraine&output=embed"
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

        {/* Enquiry Form */}
        <div className="bg-pd-offwhite rounded-xl p-8 border border-pd-steel-light/20 h-fit">
          <h2 className="text-xl font-bold text-pd-charcoal mb-1">Send an Enquiry</h2>
          <p className="text-sm text-pd-steel-light mb-7">
            Tell us what you need and we'll get back to you as quickly as we can.
          </p>
          <form className="space-y-5" onSubmit={(e) => e.preventDefault()}>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-xs uppercase tracking-wider text-pd-steel">Name</Label>
                <Input id="name" placeholder="Your name" className="h-11 bg-pd-offwhite border-pd-steel-light/30 text-pd-charcoal placeholder:text-pd-steel-light" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone" className="text-xs uppercase tracking-wider text-pd-steel">Phone</Label>
                <Input id="phone" placeholder="Your phone number" className="h-11 bg-pd-offwhite border-pd-steel-light/30 text-pd-charcoal placeholder:text-pd-steel-light" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs uppercase tracking-wider text-pd-steel">Email</Label>
              <Input id="email" type="email" placeholder="your@email.com" className="h-11 bg-pd-offwhite border-pd-steel-light/30 text-pd-charcoal placeholder:text-pd-steel-light" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="message" className="text-xs uppercase tracking-wider text-pd-steel">Message</Label>
              <Textarea id="message" rows={5} placeholder="What parts do you need? Include vehicle details if possible." className="bg-pd-offwhite border-pd-steel-light/30 text-pd-charcoal placeholder:text-pd-steel-light" />
            </div>
            <Button type="submit" className="w-full bg-pd-accent hover:bg-pd-accent-light text-foreground font-semibold h-11">
              Send Enquiry <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </form>
        </div>
      </div>
    </section>
  </div>
);

export default PublicContact;
