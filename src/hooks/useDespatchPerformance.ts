import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Bucket = "day" | "week" | "month" | "quarter";

export interface DespatchBucketRow {
  bucket_start: string;
  channel: string | null;
  total: number;
  under_6h: number;
  under_12h: number;
  under_24h: number;
  under_36h: number;
  under_48h: number;
  under_72h: number;
  over_72h: number;
  median_hours: number | null;
  mean_hours: number | null;
}

export interface DespatchChannelRow {
  channel: string;
  despatched_count: number;
}

export const useDespatchChannels = () => {
  return useQuery({
    queryKey: ["despatch-channels"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_despatch_channels" as any);
      if (error) throw error;
      return (data as any[]).map((d): DespatchChannelRow => ({
        channel: d.channel,
        despatched_count: Number(d.despatched_count) || 0,
      }));
    },
    staleTime: 5 * 60 * 1000,
  });
};

export const useDespatchBuckets = (
  fromDate: string,
  toDate: string,
  bucket: Bucket,
  channels: string[] | null,
  enabled = true,
) => {
  return useQuery({
    queryKey: ["despatch-buckets", fromDate, toDate, bucket, channels?.slice().sort().join(",") ?? "all"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_despatch_performance_buckets" as any, {
        from_date: fromDate,
        to_date: toDate,
        bucket,
        channels: channels && channels.length > 0 ? channels : null,
      });
      if (error) throw error;
      return (data as any[]).map((d): DespatchBucketRow => ({
        bucket_start: d.bucket_start,
        channel: d.channel,
        total: Number(d.total) || 0,
        under_6h: Number(d.under_6h) || 0,
        under_12h: Number(d.under_12h) || 0,
        under_24h: Number(d.under_24h) || 0,
        under_36h: Number(d.under_36h) || 0,
        under_48h: Number(d.under_48h) || 0,
        under_72h: Number(d.under_72h) || 0,
        over_72h: Number(d.over_72h) || 0,
        median_hours: d.median_hours == null ? null : Number(d.median_hours),
        mean_hours: d.mean_hours == null ? null : Number(d.mean_hours),
      }));
    },
  });
};
