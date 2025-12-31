import { ReactNode } from "react";
import { useCapability, AppCapability } from "@/hooks/useCapability";

interface AccessGateProps {
  area: string;
  minCapability?: AppCapability;
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Conditionally renders children based on user's capability for an area.
 * 
 * @param area - The system area key (e.g., 'operations.dashboard')
 * @param minCapability - Minimum capability required (default: 'read')
 * @param children - Content to render if user has sufficient capability
 * @param fallback - Optional content to render if user lacks capability
 */
export const AccessGate = ({
  area,
  minCapability = 'read',
  children,
  fallback = null,
}: AccessGateProps) => {
  const { hasCapability, isLoading } = useCapability(area);

  if (isLoading) {
    return null; // Or a loading skeleton
  }

  if (!hasCapability(minCapability)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};
