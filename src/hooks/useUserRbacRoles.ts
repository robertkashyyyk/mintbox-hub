import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type RbacRole = 
  | 'systems_controller'
  | 'commercial_governor'
  | 'inventory_steward'
  | 'operations_steward'
  | 'execution_operator'
  | 'customer_service_operator'
  | 'finance_governor'
  | 'executive_viewer';

export interface UserRbacRole {
  id: string;
  userId: string;
  role: RbacRole;
  isActive: boolean;
  createdAt: string;
}

export interface RoleConflict {
  roleA: RbacRole;
  roleB: RbacRole;
  reason: string;
}

export const RBAC_ROLE_LABELS: Record<RbacRole, { label: string; description: string }> = {
  systems_controller: {
    label: 'Systems Controller',
    description: 'Full administrative access to all systems and user management',
  },
  commercial_governor: {
    label: 'Commercial Governor',
    description: 'Revenue strategy, pricing decisions, and commercial analytics',
  },
  inventory_steward: {
    label: 'Inventory Steward',
    description: 'Stock management, buy recommendations, and inventory health',
  },
  operations_steward: {
    label: 'Operations Steward',
    description: 'Operations monitoring, dashboards, and warehouse oversight',
  },
  execution_operator: {
    label: 'Execution Operator',
    description: 'Execute actions: price updates, stock syncs, listing cloning',
  },
  customer_service_operator: {
    label: 'Customer Service Operator',
    description: 'Read-only access to operations for customer inquiries',
  },
  finance_governor: {
    label: 'Finance Governor',
    description: 'Financial oversight, billing, and decision analytics',
  },
  executive_viewer: {
    label: 'Executive Viewer',
    description: 'Read-only oversight of operations and reports',
  },
};

export const useUserRbacRoles = (userId?: string) => {
  return useQuery({
    queryKey: ['user-rbac-roles', userId],
    queryFn: async () => {
      if (!userId) return [];

      const { data, error } = await supabase
        .from('user_rbac_roles')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true);

      if (error) {
        console.error('Error fetching user RBAC roles:', error);
        throw error;
      }

      return (data || []).map(row => ({
        id: row.id,
        userId: row.user_id,
        role: row.role as RbacRole,
        isActive: row.is_active,
        createdAt: row.created_at,
      }));
    },
    enabled: !!userId,
  });
};

export const useRoleConflicts = () => {
  return useQuery({
    queryKey: ['role-conflicts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('role_conflicts')
        .select('*');

      if (error) {
        console.error('Error fetching role conflicts:', error);
        throw error;
      }

      return (data || []).map(row => ({
        roleA: row.role_a as RbacRole,
        roleB: row.role_b as RbacRole,
        reason: row.reason,
      }));
    },
    staleTime: Infinity, // Conflicts don't change often
  });
};

export const useAssignRbacRole = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: RbacRole }) => {
      const { data, error } = await supabase
        .from('user_rbac_roles')
        .insert({
          user_id: userId,
          role: role,
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['user-rbac-roles', variables.userId] });
      queryClient.invalidateQueries({ queryKey: ['all-users-with-rbac-roles'] });
    },
  });
};

export const useRemoveRbacRole = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: RbacRole }) => {
      const { error } = await supabase
        .from('user_rbac_roles')
        .delete()
        .eq('user_id', userId)
        .eq('role', role);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['user-rbac-roles', variables.userId] });
      queryClient.invalidateQueries({ queryKey: ['all-users-with-rbac-roles'] });
    },
  });
};

export const useCheckRoleConflict = () => {
  const { data: conflicts = [] } = useRoleConflicts();

  return (existingRoles: RbacRole[], newRole: RbacRole): RoleConflict | null => {
    for (const existing of existingRoles) {
      const conflict = conflicts.find(
        c => c.roleA === newRole && c.roleB === existing
      );
      if (conflict) return conflict;
    }
    return null;
  };
};
