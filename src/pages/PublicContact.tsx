import { Phone, Mail, MapPin, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

const PublicContact = () => (
  <div>
    <section className="bg-pd-charcoal py-16 md:py-20">
      <div className="container mx-auto px-4 text-center max-w-3xl">
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-4">Contact Us</h1>
        <p className="text-white/60 text-lg">
          Get in touch by phone, email, or visit our counter in Coleraine. We're here to help.
        </p>
      </div>
    </section>

    <section className="container mx-auto px-4 py-16">
      <div className="grid lg:grid-cols-2 gap-10">
        {/* Contact Info */}
        <div className="space-y-6">
          <Card className="border-pd-steel/20 bg-white">
            <CardContent className="p-6 space-y-4">
              <h2 className="text-lg font-bold text-pd-charcoal">Get in Touch</h2>
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-pd-amber shrink-0" />
                  <a href="tel:+442870344344" className="text-pd-charcoal hover:text-pd-amber transition-colors font-medium">
                    028 7034 4344
                  </a>
                </div>
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-pd-amber shrink-0" />
                  <a href="mailto:sales@partsdoc.co.uk" className="text-pd-charcoal hover:text-pd-amber transition-colors">
                    sales@partsdoc.co.uk
                  </a>
                </div>
                <div className="flex items-start gap-3">
                  <MapPin className="h-4 w-4 text-pd-amber shrink-0 mt-0.5" />
                  <span className="text-pd-charcoal">Coleraine, Co. Londonderry, Northern Ireland</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-pd-steel/20 bg-white">
            <CardContent className="p-6">
              <h2 className="text-lg font-bold text-pd-charcoal mb-3 flex items-center gap-2">
                <Clock className="h-4 w-4 text-pd-amber" /> Opening Hours
              </h2>
              <ul className="space-y-1.5 text-sm">
                <li className="flex justify-between text-pd-charcoal"><span>Monday – Friday</span><span className="font-medium">8:30 – 17:30</span></li>
                <li className="flex justify-between text-pd-charcoal"><span>Saturday</span><span className="font-medium">9:00 – 13:00</span></li>
                <li className="flex justify-between text-pd-steel"><span>Sunday</span><span>Closed</span></li>
              </ul>
            </CardContent>
          </Card>

          {/* Map placeholder */}
          <div className="bg-pd-charcoal/5 rounded-lg h-52 flex items-center justify-center text-pd-steel border border-pd-steel/20">
            <div className="text-center">
              <MapPin className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <span className="text-sm">Map — Coleraine, NI</span>
            </div>
          </div>
        </div>

        {/* Enquiry Form */}
        <Card className="border-pd-steel/20 bg-white h-fit">
          <CardContent className="p-6">
            <h2 className="text-lg font-bold text-pd-charcoal mb-1">Send an Enquiry</h2>
            <p className="text-sm text-pd-steel mb-6">
              Tell us what you need and we'll get back to you as quickly as we can.
            </p>
            <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" placeholder="Your name" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" placeholder="Your phone number" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" placeholder="your@email.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="message">Message</Label>
                <Textarea id="message" rows={5} placeholder="What parts do you need? Include vehicle details if possible." />
              </div>
              <Button type="submit" className="w-full bg-pd-amber hover:bg-pd-amber/90 text-pd-charcoal font-semibold">
                Send Enquiry
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </section>
  </div>
);

export default PublicContact;
