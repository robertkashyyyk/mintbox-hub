

# Restyle Invite Email to Match PartsDoc Hub Branding

## Problem
The current invite email uses purple gradients and generic styling. It should reflect the PartsDoc Hub brand — dark charcoal/graphite tones, teal accent, and the "PD" logo mark.

## Brand Colours (from CSS variables)
- Charcoal: `#0f172a` (hsl 222 47% 11%)
- Graphite: `#1e293b` (hsl 217 33% 17%)
- Teal accent: `#279e8a` (hsl 174 58% 37%)
- Teal light: `#2eb8a1` (hsl 174 42% 50%)
- Steel: `#4a5568` (hsl 215 14% 34%)
- Off-white: `#f7f9fb`

## Changes — `supabase/functions/send-invite-email/index.ts`

1. **Header banner** — Replace purple gradient with charcoal-to-graphite gradient (`#0f172a` → `#1e293b`). Add "PD" logo badge (white text on teal circle) and title "PartsDoc Hub" instead of just "You're Invited!"
2. **CTA button** — Replace purple gradient with solid teal (`#279e8a`), white text
3. **Role info box** — Subtle teal-tinted background (`#f0fdf9`) with teal left border instead of plain grey
4. **Body heading** — "Welcome to PartsDoc Hub" instead of "Welcome to Mintsoft Inventory System"
5. **Subject line** — "You've been invited to PartsDoc Hub"
6. **From name** — Update to "PartsDoc Hub" (keep same sender address)
7. **Footer text** — Reference PartsDoc Hub
8. **Text colours** — Use charcoal (`#0f172a`) for headings, steel (`#4a5568`) for body text

## File Modified
- `supabase/functions/send-invite-email/index.ts`

