
# Reduce CSV Chunk Size to 500

## Overview
Reduce the chunk size for CSV uploads from 2,000 to 500 rows per batch for better stability and faster perceived progress.

## Why This Helps
- **Faster feedback**: More frequent progress updates as chunks complete quickly
- **Lower timeout risk**: Smaller batches are less likely to hit Edge Function limits
- **Better recovery**: If a chunk fails, you lose less progress

## Trade-off
A 200,000 row file will now require 400 chunks instead of 100, meaning more HTTP requests. However, each request completes faster and the progress bar updates more frequently, giving a smoother experience.

---

## Technical Details

### Change Required

**File**: `src/hooks/useChunkedCsvUpload.ts`

Update line 4:
```typescript
// From:
const CHUNK_SIZE = 2000;

// To:
const CHUNK_SIZE = 500;
```

That's the only change needed - the rest of the chunking logic automatically adapts to whatever value is set.
