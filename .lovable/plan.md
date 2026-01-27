
# Fix CSV Upload CPU Timeout Issue

## Problem Identified
The edge function is hitting **CPU time limits** (not wall-clock time) during CSV processing. Even with 500-row chunks, the character-by-character CSV parsing and multiple string operations per row consume too much CPU.

## Proposed Solution

### 1. Reduce Client Chunk Size to 100 Rows
Smaller chunks mean less CPU work per request. With 100-row chunks, a 200k file becomes 2,000 requests, but each completes in milliseconds.

**File**: `src/hooks/useChunkedCsvUpload.ts`
- Change `CHUNK_SIZE` from 500 to 100

### 2. Optimize Edge Function Parsing
The current implementation is CPU-heavy. We'll streamline it for minimal imports specifically.

**File**: `supabase/functions/process-product-csv/index.ts`

Key optimizations:
- Use a simple `.split(',')` for minimal imports (no quoted fields in typical Mintsoft exports)
- Reduce `findColumn()` calls by checking header indices once upfront
- Lower the batch size to 100 to match incoming chunk size
- Skip unnecessary processing for minimal imports (no barcode detection, no category parsing)

### 3. Add Early Bail-Out for Empty Chunks
Prevent processing if a chunk has no valid rows.

---

## Technical Details

### Client-Side Change
```typescript
// src/hooks/useChunkedCsvUpload.ts
const CHUNK_SIZE = 100; // Reduced from 500 to prevent CPU timeouts
```

### Edge Function Optimizations

1. **Pre-compute header indices** (O(1) lookup instead of O(n) per row):
```typescript
// Build column index map once
const columnIndices: Record<string, number> = {};
headers.forEach((h, idx) => {
  const normalized = h.trim();
  columnIndices[normalized] = idx;
  columnIndices[normalized.toLowerCase()] = idx;
});
```

2. **Simplified minimal import parsing**:
```typescript
// For minimal imports, use simple split (no quoted field handling needed)
if (isMinimalImport) {
  const values = line.split(',');
  // Direct index access instead of findColumn loops
}
```

3. **Reduce batch size to match chunk size**:
```typescript
const BATCH_SIZE = 100; // Match client chunk size
```

---

## Trade-offs
| Aspect | Before | After |
|--------|--------|-------|
| Rows per request | 500 | 100 |
| Requests for 200k rows | 400 | 2,000 |
| CPU per request | High (timeouts) | Low (completes fast) |
| Total upload time | Fails | ~5-10 minutes |

## Expected Outcome
- No more `CPU Time exceeded` errors
- Reliable processing of massive CSV files
- More granular progress updates (every 100 rows)
