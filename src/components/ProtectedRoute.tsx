import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useCapability, AppCapability } from "@/hooks/useCapability";
import { useRbacEnabled } from "@/hooks/useRbacEnabled";
import { Loader2 } from "lucide-react";

interface ProtectedRouteProps {
  area: string;
  minCapability?: AppCapability;
  children: ReactNode;
}

/**
 * Protects a route based on RBAC permissions.
 * Redirects to /access-denied if user lacks required capability.
 * Only active when RBAC navigation is enabled.
 * 
 * @param area - The system area key (e.g., 'operations.reports')
 * @param minCapability - Minimum capability required (default: 'read')
 * @param children - The route content to render
 */
export const ProtectedRoute = ({
  area,
  minCapability = 'read',
  children,
}: ProtectedRouteProps) => {
  const location = useLocation();
  const { data: rbacEnabled, isLoading: rbacLoading } = useRbacEnabled();
  const { hasCapability, isLoading: capabilityLoading } = useCapability(area);

  // If RBAC is disabled, allow access (fall back to legacy behavior)
  if (!rbacEnabled) {
    return <>{children}</>;
  }

  // Show loading state
  if (rbacLoading || capabilityLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Checking permissions...</p>
        </div>
      </div>
    );
  }

  // Check capability
  if (!hasCapability(minCapability)) {
    return (
      <Navigate 
        to="/access-denied" 
        state={{ 
          from: location.pathname,
          area,
          requiredCapability: minCapability,
        }} 
        replace 
      />
    );
  }

  return <>{children}</>;
};
