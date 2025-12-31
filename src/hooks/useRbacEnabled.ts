import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const useRbacEnabled = () => {
  return useQuery({
    queryKey: ['rbac-enabled'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'use_rbac_navigation')
        .single();

      if (error) {
        console.error('Error fetching RBAC setting:', error);
        return false;
      }

      return data?.value === true;
    },
    staleTime: 60 * 1000, // Cache for 1 minute
  });
};
