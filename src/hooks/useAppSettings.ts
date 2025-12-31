import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Json } from "@/integrations/supabase/types";

export const useAppSetting = <T = Json>(key: string) => {
  return useQuery({
    queryKey: ['app-setting', key],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', key)
        .single();

      if (error) {
        console.error(`Error fetching app setting "${key}":`, error);
        return null;
      }

      return data?.value as T;
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
};

export const useUpdateAppSetting = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: Json }) => {
      const { error } = await supabase
        .from('app_settings')
        .update({ value, updated_at: new Date().toISOString() })
        .eq('key', key);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['app-setting', variables.key] });
      queryClient.invalidateQueries({ queryKey: ['rbac-enabled'] });
    },
  });
};
