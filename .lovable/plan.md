

# Fix Dark-Mode Filter Input Visibility

## Problem
In dark mode, `Input` and `SelectTrigger` components use `bg-background` (very dark, `hsl(222 47% 11%)`) sitting on `bg-card` (`hsl(217 33% 17%)`), with `border-input` at only 15% white opacity. This makes inputs appear as near-invisible dark rectangles — labels and placeholders blend into the background.

## Root Cause
The dark-mode CSS variable `--input: 0 0% 100% / 15%` is too subtle. The background difference between `--background` and `--card` also creates a "darker hole" effect.

## Fix — Update dark-mode CSS variables in `src/index.css`

1. **Bump `--input` border opacity** from `15%` to `25%` so input borders are clearly visible
2. **Bump `--border` opacity** from `10%` to `15%` for general border visibility improvement
3. **Change input background behavior** — add a subtle lighter input background variable or override `bg-background` on inputs to use the card color so they don't appear darker than their container

Specifically in the `.dark` block:
- `--input: 0 0% 100% / 25%;` (was 15%)
- `--border: 0 0% 100% / 15%;` (was 10%)

This is a global fix affecting all inputs/selects across the entire hub — no need to patch individual filter components.

## Files Modified
- `src/index.css` — dark-mode variable adjustments (2 lines)

