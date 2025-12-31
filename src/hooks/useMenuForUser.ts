import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppCapability } from "./useCapability";

export interface MenuItem {
  key: string;
  label: string;
  parentKey: string | null;
  routePath: string | null;
  iconName: string | null;
  sortOrder: number;
  capability: AppCapability;
  children?: MenuItem[];
}

export interface MenuGroup {
  key: string;
  label: string;
  iconName: string | null;
  routePath: string | null;
  capability: AppCapability;
  items: MenuItem[];
}

export const useMenuForUser = () => {
  return useQuery({
    queryKey: ['menu-for-user'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('menu_for_user')
        .select('*')
        .order('sort_order');

      console.log('[RBAC Menu] data:', data);
      console.log('[RBAC Menu] error:', error);

      if (error) {
        console.error('Error fetching menu:', error);
        throw error;
      }

      // Transform flat data into hierarchical structure
      const items: MenuItem[] = (data || []).map(item => ({
        key: item.key,
        label: item.label,
        parentKey: item.parent_key,
        routePath: item.route_path,
        iconName: item.icon_name,
        sortOrder: item.sort_order,
        capability: item.capability as AppCapability,
      }));

      // Build parent-child relationships
      const parentItems = items.filter(item => item.parentKey === null);
      const childItems = items.filter(item => item.parentKey !== null);

      const menuGroups: MenuGroup[] = parentItems.map(parent => ({
        key: parent.key,
        label: parent.label,
        iconName: parent.iconName,
        routePath: parent.routePath,
        capability: parent.capability,
        items: childItems
          .filter(child => child.parentKey === parent.key)
          .sort((a, b) => a.sortOrder - b.sortOrder),
      }));

      return menuGroups;
    },
    staleTime: 5 * 60 * 1000,
  });
};
