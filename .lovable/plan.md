

# Mirror PartsDoc Branding into the Hub (Post-Login)

## What Changes
Restyle the internal dashboard to use the same Carbon & Teal palette from the public site. The Hub should feel like a continuation of the brand, not a completely different app.

## 1. Update Dark Mode CSS Variables (`src/index.css`)
Remap the `.dark` theme to use the PartsDoc palette:
- `--background`: pd-charcoal (`222 47% 11%`)
- `--card`: pd-graphite (`217 33% 17%`)
- `--primary`: pd-accent teal (`174 58% 37%`)
- `--primary-foreground`: white
- `--accent`: slightly lighter graphite
- `--sidebar-background`: pd-charcoal
- `--sidebar-primary`: pd-accent teal
- `--border` / `--input`: white/10% on dark
- `--ring`: pd-accent teal

## 2. Force Dark Mode on Hub (`src/pages/DashboardLayout.tsx`)
- Add `dark` class to the root wrapper so the Hub always renders in dark mode (matching the carbon feel)
- Style the top header bar with pd-charcoal background, teal accent for the "PartsDoc Hub" branding
- Add "PartsDoc Hub" text branding in the header alongside the sidebar trigger

## 3. Restyle Sidebar (`src/components/AppSidebar.tsx`)
- The sidebar already uses `--sidebar-*` variables, so the CSS variable changes will cascade automatically
- Add a "PartsDoc" brand mark at the top of the sidebar
- Style active nav items with teal accent highlight
- Teal accent on hover states

## 4. Restyle Auth Page (`src/pages/Auth.tsx`)
- Dark background matching pd-charcoal
- Teal-accented login button
- "PartsDoc Hub" branding above the form
- Update `brand` / `brandAccent` colors to teal

## Files to Modify
- `src/index.css` — remap `.dark` variables to Carbon & Teal palette
- `src/pages/DashboardLayout.tsx` — force dark class, brand header
- `src/components/AppSidebar.tsx` — add brand mark at top
- `src/pages/Auth.tsx` — dark themed login with teal accents and branding

