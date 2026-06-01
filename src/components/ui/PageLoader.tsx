/**
 * PageLoader — branded loading state for slow data pages.
 *
 * Combines:
 *  1. PartsDoc logo with a wrench-tighten oscillation animation
 *  2. Animated "Loading…" label with cycling dots
 *  3. Skeleton rows that mimic the shape of the real table
 *
 * Usage:
 *   <PageLoader rows={8} columns={[180, 100, 120, 80, 60]} />
 *
 * `columns` is an optional array of pixel widths for the skeleton cells.
 * If omitted, 5 equal-width columns are used.
 */

import brandIcon from "@/assets/brand/partsdoc-icon-teal.png";
import { Skeleton } from "@/components/ui/skeleton";

interface PageLoaderProps {
  /** Number of skeleton table rows to render (default 8) */
  rows?: number;
  /** Approximate pixel widths for each skeleton cell. Drives the column count. */
  columns?: number[];
  /** Optional label shown beneath the spinner (default "Loading") */
  label?: string;
}

export function PageLoader({
  rows = 8,
  columns = [200, 100, 120, 100, 80],
  label = "Loading",
}: PageLoaderProps) {
  return (
    <div className="w-full space-y-6 py-4">
      {/* ── Branded spinner ── */}
      <div className="flex flex-col items-center gap-3 py-4">
        <img
          src={brandIcon}
          alt="Loading…"
          className="h-10 w-10 object-contain"
          style={{ animation: "pd-wrench-tighten 1.4s ease-in-out infinite" }}
        />
        <AnimatedLabel label={label} />
      </div>

      {/* ── Skeleton table ── */}
      <div className="rounded-md border border-border overflow-hidden">
        {/* Header row */}
        <div className="flex items-center gap-4 px-4 py-3 border-b border-border bg-muted/30">
          {columns.map((w, i) => (
            <Skeleton key={i} className="h-3 rounded" style={{ width: w * 0.6, flexShrink: 0 }} />
          ))}
        </div>
        {/* Data rows */}
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div
            key={rowIdx}
            className="flex items-center gap-4 px-4 py-3 border-b border-border last:border-0"
            style={{ opacity: 1 - rowIdx * (0.65 / rows) }}
          >
            {columns.map((w, colIdx) => (
              <Skeleton
                key={colIdx}
                className="h-4 rounded"
                style={{
                  width: w * (0.5 + Math.random() * 0.5),
                  flexShrink: 0,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** "Loading..." with cycling dots */
function AnimatedLabel({ label }: { label: string }) {
  return (
    <span
      className="text-sm text-muted-foreground tracking-wide"
      style={{ animation: "pd-loading-dots 1.4s steps(4, end) infinite" }}
    >
      {label}
      <span className="inline-block w-6 text-left" aria-hidden>
        <span style={{ animation: "pd-dot-1 1.4s steps(4, end) infinite" }}>.</span>
        <span style={{ animation: "pd-dot-2 1.4s steps(4, end) infinite" }}>.</span>
        <span style={{ animation: "pd-dot-3 1.4s steps(4, end) infinite" }}>.</span>
      </span>
    </span>
  );
}

/*
 * Keyframes are injected once via a <style> tag rendered alongside the
 * component. Tailwind doesn't support arbitrary keyframe animations natively,
 * so this keeps the animations co-located with the component.
 */
const KEYFRAMES = `
@keyframes pd-wrench-tighten {
  0%   { transform: rotate(0deg)   scale(1);    opacity: 0.85; }
  20%  { transform: rotate(-18deg) scale(1.08); opacity: 1;    }
  40%  { transform: rotate(12deg)  scale(1.04); opacity: 1;    }
  60%  { transform: rotate(-8deg)  scale(1.02); opacity: 0.95; }
  80%  { transform: rotate(4deg)   scale(1);    opacity: 0.9;  }
  100% { transform: rotate(0deg)   scale(1);    opacity: 0.85; }
}
@keyframes pd-dot-1 {
  0%, 24%  { opacity: 0; }
  25%, 100% { opacity: 1; }
}
@keyframes pd-dot-2 {
  0%, 49%  { opacity: 0; }
  50%, 100% { opacity: 1; }
}
@keyframes pd-dot-3 {
  0%, 74%  { opacity: 0; }
  75%, 100% { opacity: 1; }
}
`;

// Inject keyframes once into the document head
if (typeof document !== "undefined" && !document.getElementById("pd-loader-keyframes")) {
  const style = document.createElement("style");
  style.id = "pd-loader-keyframes";
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
}
