## Image Scout v2 — Slice 1

Ship the foundation: brand-aware retrieval rules + per-candidate confidence scoring + a manual editor for brand profiles, with auto-suggestions powered by retrieval history. No review queue, no enhancement engine yet.

## What changes

### 1. Brand image profiles (new)

New table `brand_image_profiles` keyed to `brands.id`:

- `preferred_domains text[]` — site:domain priority list
- `blocked_domains text[]` — never return results from these
- `search_templates text[]` — e.g. `"{brand} {part_number}"`, `"{part_number} site:autodoc.co.uk"`
- `image_rules jsonb` — `{prefer_product_only, reject_diagrams, reject_watermarks, prefer_white_background}`
- `notes text`, `updated_at`, `updated_by`

Manual editor at `/discovery/image-scout/brand-profiles` (super_user / senior_user). Lists every brand from `brands`, shows current profile or "no profile yet", inline edit dialog with chips for domains and templates.

### 2. Candidate gathering (rewrite of `image-scout-process`)

Today the function picks one image. New flow:

1. Detect brand by SKU prefix → load `brand_image_profiles` row (fall back to defaults).
2. Strip prefix → `clean_part_number`.
3. Expand `search_templates` → run each via Google CSE + Firecrawl scrape of preferred domains.
4. Filter results against `blocked_domains`.
5. Collect ALL candidates (target ~10-20 per SKU) into a new `image_scout_candidates` table:
   - `sku`, `brand_id`, `source_url`, `image_url`, `image_width`, `image_height`, `from_template`, `from_domain`, `confidence_score numeric`, `confidence_reasoning jsonb`, `created_at`
6. Score each candidate (see below).
7. Auto-pick the top scorer ≥ threshold; otherwise leave for manual selection on the SKU detail page.

### 3. Confidence scoring

Pure deterministic function in the edge runtime (no LLM). Inputs: candidate metadata + page text snippet from CSE/Firecrawl.

Positive signals (configurable weights, defaults shown):

- Part number on page (+25), brand on page (+15)
- Image ≥ 800×800 (+15), ≥ 1500×1500 (+5 more)
- Source domain in preferred list (+20), official manufacturer (+10 extra)
- Filename contains part number (+10)
- White-ish background heuristic from URL/CDN hints (+5)

Negative signals:

- Source in blocked list → reject outright
- URL/page text contains "diagram", "schematic", "exploded view" (-20)
- "lifestyle", "vehicle", "car interior" (-15)
- Image < 400×400 (-30)
- Watermark hint in URL (-10)

`confidence_reasoning` stores the matched rules so the UI can explain the score.

### 4. Auto-suggestion loop

When a SKU's image is approved (existing path) or a candidate is manually picked:

- Increment usage counter on the source domain in a new `brand_image_profile_suggestions` table (`brand_id`, `domain`, `template`, `success_count`, `last_used`).
- Brand profile editor shows a "Suggested additions" panel: top 5 unused domains and templates with success counts and a "promote" button that pushes them into `preferred_domains` / `search_templates`.

### 5. UI

- `/discovery/image-scout/brand-profiles` — list + editor.
- `/discovery/image-scout` — existing dashboard gets a new "Candidates" tab per SKU showing the scored candidates with thumbnails, score, reasoning, and "Use this image" action.
- Subpage header pattern (bold h1 + teal ghost back button), semantic tokens only.

### 6. Out of scope (slice 1)

- Full review queue states (Pending/Approved/Rejected/Manual/Regenerate) — current approve/reject flow stays.
- Enhancement engine (Photoroom + Real-ESRGAN) — wire in slice 2.
- Bing API, TecDoc, per-brand custom scrapers.

## Order of build

1. Migration: `brand_image_profiles`, `image_scout_candidates`, `brand_image_profile_suggestions` + RLS.
2. Refactor `image-scout-process` to gather + score candidates.
3. Brand profiles editor page + nav (AppSidebar + RbacSidebar + system_areas + role_area_permissions).
4. Candidates tab on Image Scout SKU detail.
5. Auto-suggestion writer + "Suggested additions" panel.
6. Seed Meyle, Febi, Bosch profiles as first examples.

After this lands and we've watched it run on a few hundred SKUs, slice 2 = full review queue + Photoroom/Real-ESRGAN enhancement pipeline.