

# PartsDoc Public Website — Replace `/` Landing Page

## Overview
Replace the current generic Index page with a full, professional public-facing website for PartsDoc. This is a single-page React component with multiple sections, plus new route pages for About, Products, Trade, Contact, and FAQ. The Hub Login button links to `/auth`.

## Palette & Design Tokens
Extend `index.css` with public-site CSS variables:
- Dark charcoal: `hsl(220, 10%, 15%)` — hero backgrounds, header
- Graphite: `hsl(220, 8%, 25%)` — secondary surfaces
- Steel grey: `hsl(220, 5%, 70%)` — borders, muted text
- Off-white: `hsl(220, 10%, 97%)` — content backgrounds
- Amber accent: `hsl(38, 92%, 50%)` — CTAs, highlights
- Success green: `hsl(142, 71%, 45%)` — trust indicators

## Files to Create

### 1. `src/pages/PublicHome.tsx` — Homepage
Full scrolling homepage with these sections:
- **Sticky Header**: PartsDoc text logo, nav links (About, Products, Trade, Contact), phone number, amber "Hub Login" button linking to `/auth`
- **Hero**: Dark charcoal background, bold headline ("Motor Parts. Real Expertise. Fast Action."), subtext, two CTAs (Browse Products, Contact Us), subtle automotive-themed CSS pattern
- **Category Tiles**: 6-8 animated cards (Braking, Suspension, Filters, Electrical, etc.) with icons
- **Why PartsDoc**: 4-column grid — Local Stock, Trade Pricing, Expert Knowledge, Fast Collection
- **Trade Section**: Dark panel aimed at garages/workshops with enquiry CTA
- **Opening Hours Strip**: Amber-accented bar with days/times
- **Trust/Testimonials**: Quote cards with star ratings
- **Location Panel**: Map placeholder, address, click-to-call
- **Footer CTA**: "Need the right part?" with contact button
- **Footer**: Contact details, quick links, opening hours, Hub Login link, copyright

### 2. `src/pages/PublicAbout.tsx` — About PartsDoc
Company story, values, team approach, Coleraine heritage

### 3. `src/pages/PublicProducts.tsx` — Products / Categories
Category-led grid with brand tiles, product family cards, "Need help finding a part?" CTA, trade enquiry CTA

### 4. `src/pages/PublicTrade.tsx` — Trade / Business Customers
Trade supply info, account benefits, parts sourcing, support, enquiry form CTA

### 5. `src/pages/PublicContact.tsx` — Contact / Visit Us
Contact card, opening hours card, map placeholder, enquiry form, click-to-call on mobile

### 6. `src/pages/PublicFAQ.tsx` — FAQ
Accordion-based FAQ using existing shadcn Accordion component

### 7. `src/components/public/PublicHeader.tsx` — Shared sticky header
Extracted for reuse across all public pages. Mobile hamburger menu.

### 8. `src/components/public/PublicFooter.tsx` — Shared footer

### 9. `src/components/public/PublicLayout.tsx` — Layout wrapper
Wraps header + children + footer for all public routes

## Routing Changes (`App.tsx`)
- Replace `<Index />` at `/` with `<PublicHome />`
- Add routes: `/about`, `/products`, `/trade`, `/contact`, `/faq`
- All wrapped in `<PublicLayout />`

## Key UX Details
- Sticky header with backdrop blur on scroll
- Scroll-reveal animations via Tailwind `animate-` classes
- Floating "Call Now" button on mobile (fixed bottom-right)
- Strong hover states on all cards
- Fully responsive — mobile-first sections
- Hub Login button always prominent (amber, top-right)
- No external dependencies needed — all built with existing shadcn + Tailwind

## Files to Modify
- `src/App.tsx` — new routes
- `src/index.css` — add public-site color variables
- `src/pages/Index.tsx` — replaced entirely

