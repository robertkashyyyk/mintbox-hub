// Public privacy policy — no sign-in required (mounted under PublicLayout).
// Plain-English UK GDPR notice for Partsdoc Ltd.

const LAST_UPDATED = "15 October 2026";

const PublicPrivacy = () => (
  <div>
    <section className="bg-pd-charcoal py-20 md:py-24">
      <div className="container mx-auto px-4 max-w-3xl text-center">
        <p className="text-pd-accent text-sm font-semibold uppercase tracking-wider mb-3">Legal</p>
        <h1 className="text-3xl md:text-5xl font-bold text-foreground mb-5">Privacy Policy</h1>
        <p className="text-foreground/75 text-lg leading-relaxed">
          How PartsDoc collects, uses and protects your personal data.
        </p>
        <p className="text-foreground/50 text-sm mt-5">Last updated: {LAST_UPDATED}</p>
      </div>
    </section>

    <section className="container mx-auto px-4 py-16 md:py-20 max-w-3xl">
      <div className="space-y-10 text-[15px] text-pd-charcoal/80 leading-relaxed">
        <p>
          This policy explains how we handle personal data when you contact us, place an order,
          or use our website. We keep it in plain English. If anything is unclear, please get in
          touch using the details below.
        </p>

        <div>
          <h2 className="text-xl font-bold text-pd-charcoal mb-3">Who we are</h2>
          <p>
            PartsDoc is a trading name of <strong>Partsdoc Ltd</strong>, a company based in the United
            Kingdom. We are the data controller responsible for your personal data.
          </p>
          <address className="not-italic mt-3">
            Partsdoc Ltd<br />
            9 Loguestown Industrial Estate<br />
            Coleraine<br />
            BT52 2NS<br />
            United Kingdom
          </address>
          <p className="mt-3">
            Email:{" "}
            <a href="mailto:sales@partsdoc.co.uk" className="text-pd-accent hover:underline font-medium">
              sales@partsdoc.co.uk
            </a>
          </p>
        </div>

        <div>
          <h2 className="text-xl font-bold text-pd-charcoal mb-3">What we collect</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              Details you give us when you contact us or place an order — your name, contact details,
              delivery address and order details.
            </li>
            <li>
              Order data we receive from the marketplaces we sell on (such as eBay and Amazon), which we
              use to fulfil and support your orders.
            </li>
            <li>Basic website usage data when you visit our site.</li>
          </ul>
        </div>

        <div>
          <h2 className="text-xl font-bold text-pd-charcoal mb-3">Why we use it</h2>
          <p>We use your personal data to:</p>
          <ul className="list-disc pl-5 space-y-2 mt-2">
            <li>fulfil your orders and provide customer support;</li>
            <li>meet our legal and accounting obligations; and</li>
            <li>run and improve our business.</li>
          </ul>
          <p className="mt-3">
            Our lawful bases for doing this are the performance of a <strong>contract</strong> with you,
            compliance with a <strong>legal obligation</strong>, and our <strong>legitimate interests</strong>
            {" "}in running and improving the business.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-bold text-pd-charcoal mb-3">Who we share it with</h2>
          <p>
            We only share personal data with service providers who help us fulfil orders and run the
            business — for example couriers, our warehouse and hosting providers, and the marketplaces
            themselves. <strong>We do not sell your personal data.</strong>
          </p>
        </div>

        <div>
          <h2 className="text-xl font-bold text-pd-charcoal mb-3">How long we keep it</h2>
          <p>
            We keep personal data only for as long as we need it for the purposes above and to meet our
            legal and accounting requirements, after which it is deleted. Where a marketplace passes us a
            customer account-deletion request, we act on it.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-bold text-pd-charcoal mb-3">Your rights</h2>
          <p>Under UK data protection law you have the right to:</p>
          <ul className="list-disc pl-5 space-y-2 mt-2">
            <li>access the personal data we hold about you;</li>
            <li>ask us to correct data that is wrong or incomplete;</li>
            <li>ask us to delete your data;</li>
            <li>object to how we use your data; and</li>
            <li>
              complain to the Information Commissioner's Office (ICO) at{" "}
              <a href="https://ico.org.uk" target="_blank" rel="noopener noreferrer" className="text-pd-accent hover:underline font-medium">
                ico.org.uk
              </a>.
            </li>
          </ul>
          <p className="mt-3">
            To exercise any of these rights, email us at{" "}
            <a href="mailto:sales@partsdoc.co.uk" className="text-pd-accent hover:underline font-medium">
              sales@partsdoc.co.uk
            </a>. We'd also encourage you to contact us first if you have a concern, so we can try to put
            things right.
          </p>
        </div>
      </div>
    </section>
  </div>
);

export default PublicPrivacy;
