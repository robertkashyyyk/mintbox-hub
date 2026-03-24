
I’ve identified the issue: the “Contact Us” style buttons are using `variant="outline"`, and that variant injects `bg-background` (white). On dark hero/CTA sections this creates white background + white text, so labels look invisible.

## Plan to fix

1. **Add a dark-surface outline button variant**
   - Update `src/components/ui/button.tsx` with a new variant (e.g. `outlineDark`) that is explicitly:
   - `bg-transparent text-white border-white/30 hover:bg-white/10 hover:text-white`
   - This prevents the default white background from leaking into dark sections.

2. **Apply the new variant on Home page CTAs**
   - Update `src/pages/PublicHome.tsx`:
   - Hero CTA secondary button (“Contact Us”)
   - Trade section secondary button (“Open a Trade Account”)

3. **Prevent repeat issues in other public dark sections**
   - Replace the same pattern in:
   - `src/pages/PublicTrade.tsx` (“Call Now”)
   - `src/pages/PublicProducts.tsx` (“Call Us”)
   - This keeps all dark-background outline buttons visually consistent.

4. **Quick contrast QA pass**
   - Verify in preview that all affected buttons show visible text in default/hover states on desktop and mobile widths.
   - Specifically confirm the two Home-page “contact” boxes no longer render white-on-white.

## Files to modify
- `src/components/ui/button.tsx`
- `src/pages/PublicHome.tsx`
- `src/pages/PublicTrade.tsx`
- `src/pages/PublicProducts.tsx`
