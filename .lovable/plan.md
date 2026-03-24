

# Fix Visibility Issues — Header & Contact Form

## Problem
1. **Header on `/`**: The header starts `bg-transparent` with `text-white` nav links. If the hero image fails to load or on initial render, white text can blend into light backgrounds. Also "Parts" in white is invisible if any light bleed occurs — only "Doc" (teal) shows.
2. **Contact form inputs**: The `Input`, `Label`, and `Textarea` components use default theme variables (`bg-background`, `border-input`) which in light mode are white/near-white — invisible inside the white card.

## Fix 1 — Header Always Dark (`src/components/public/PublicHeader.tsx`)
- Change default (non-scrolled) state from `bg-transparent` to `bg-pd-charcoal` so white text always sits on a dark background
- Scrolled state stays `bg-pd-charcoal/98 backdrop-blur-lg`
- This guarantees visibility on every page, regardless of hero image loading

## Fix 2 — Contact Form Contrast (`src/pages/PublicContact.tsx`)
- Add explicit classes to `Input` and `Textarea`: `bg-white border-pd-steel-light/30 text-pd-charcoal placeholder:text-pd-steel-light`
- Change `Label` from `text-pd-steel-light` to `text-pd-steel` (darker) for better readability
- Ensure form fields have visible borders and text against the white card

## Fix 3 — Light-Section Text Audit (quick pass)
- `PublicHome.tsx` — "Product Categories" and "Testimonials" section headings use `text-pd-charcoal` which should be fine, but verify `Card` borders (`border-pd-steel-light/20`) are strong enough; bump to `/30`

## Files to Modify
- `src/components/public/PublicHeader.tsx` — always-dark header background
- `src/pages/PublicContact.tsx` — explicit input/label styling
- `src/pages/PublicHome.tsx` — minor border contrast bump

