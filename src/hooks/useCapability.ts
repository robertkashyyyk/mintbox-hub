import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppCapability = 'none' | 'read' | 'propose' | 'execute' | 'admin';

const CAPABILITY_RANK: Record<AppCapability, number> = {
  none: 0,
  read: 1,
  propose: 2,
  execute: 3,
  admin: 4,
};

export const useCapability = (areaKey: string) => {
  const { data: capability = 'none' as AppCapability, isLoading } = useQuery({
    queryKey: ['capability', areaKey],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('user_area_capability', {
        area_key: areaKey,
      });
      
      if (error) {
        console.error('Error fetching capability:', error);
        return 'none' as AppCapability;
      }
      
      return (data as AppCapability) || 'none';
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  const hasCapability = (minCapability: AppCapability): boolean => {
    return CAPABILITY_RANK[capability] >= CAPABILITY_RANK[minCapability];
  };

  const canRead = hasCapability('read');
  const canPropose = hasCapability('propose');
  const canExecute = hasCapability('execute');
  const isAdmin = hasCapability('admin');

  return {
    capability,
    isLoading,
    hasCapability,
    canRead,
    canPropose,
    canExecute,
    isAdmin,
  };
};

export const useCapabilities = (areaKeys: string[]) => {
  return useQuery({
    queryKey: ['capabilities', areaKeys],
    queryFn: async () => {
      const results: Record<string, AppCapability> = {};
      
      for (const key of areaKeys) {
        const { data, error } = await supabase.rpc('user_area_capability', {
          area_key: key,
        });
        
        if (error) {
          console.error(`Error fetching capability for ${key}:`, error);
          results[key] = 'none';
        } else {
          results[key] = (data as AppCapability) || 'none';
        }
      }
      
      return results;
    },
    staleTime: 5 * 60 * 1000,
  });
};
