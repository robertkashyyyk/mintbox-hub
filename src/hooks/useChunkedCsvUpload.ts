import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

const CHUNK_SIZE = 5000; // rows per chunk

interface ChunkProgress {
  totalRows: number;
  processedRows: number;
  currentChunk: number;
  totalChunks: number;
  importedCount: number;
  status: "idle" | "parsing" | "uploading" | "complete" | "error";
  error?: string;
}

interface UploadResult {
  imported: number;
  categories: number;
}

export function useChunkedCsvUpload() {
  const [progress, setProgress] = useState<ChunkProgress>({
    totalRows: 0,
    processedRows: 0,
    currentChunk: 0,
    totalChunks: 0,
    importedCount: 0,
    status: "idle",
  });

  const parseCSV = useCallback((content: string): { headers: string; rows: string[] } => {
    const lines = content.trim().split("\n");
    const headers = lines[0];
    const rows = lines.slice(1).filter((line) => line.trim());
    return { headers, rows };
  }, []);

  const processChunkedUpload = useCallback(
    async (file: File, uploadName: string, userId: string): Promise<UploadResult> => {
      setProgress({
        totalRows: 0,
        processedRows: 0,
        currentChunk: 0,
        totalChunks: 0,
        importedCount: 0,
        status: "parsing",
      });

      const content = await file.text();
      const { headers, rows } = parseCSV(content);
      const totalRows = rows.length;
      const totalChunks = Math.ceil(totalRows / CHUNK_SIZE);

      setProgress((prev) => ({
        ...prev,
        totalRows,
        totalChunks,
        status: "uploading",
      }));

      let totalImported = 0;
      let totalCategories = 0;

      for (let i = 0; i < totalChunks; i++) {
        const startIdx = i * CHUNK_SIZE;
        const endIdx = Math.min(startIdx + CHUNK_SIZE, totalRows);
        const chunkRows = rows.slice(startIdx, endIdx);
        const chunkContent = [headers, ...chunkRows].join("\n");

        setProgress((prev) => ({
          ...prev,
          currentChunk: i + 1,
        }));

        const { data, error } = await supabase.functions.invoke(
          "process-product-csv",
          {
            body: {
              csvContent: chunkContent,
              uploadName: totalChunks > 1 ? `${uploadName} (Chunk ${i + 1}/${totalChunks})` : uploadName,
              userId,
              isChunk: totalChunks > 1,
              chunkIndex: i,
              totalChunks,
            },
          }
        );

        if (error) {
          setProgress((prev) => ({
            ...prev,
            status: "error",
            error: error.message || "Failed to process chunk",
          }));
          throw error;
        }

        totalImported += data.imported || 0;
        totalCategories = Math.max(totalCategories, data.categories || 0);

        setProgress((prev) => ({
          ...prev,
          processedRows: endIdx,
          importedCount: totalImported,
        }));
      }

      setProgress((prev) => ({
        ...prev,
        status: "complete",
        importedCount: totalImported,
      }));

      return { imported: totalImported, categories: totalCategories };
    },
    [parseCSV]
  );

  const reset = useCallback(() => {
    setProgress({
      totalRows: 0,
      processedRows: 0,
      currentChunk: 0,
      totalChunks: 0,
      importedCount: 0,
      status: "idle",
    });
  }, []);

  return {
    progress,
    processChunkedUpload,
    reset,
  };
}
