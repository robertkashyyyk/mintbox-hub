import { 
  Search, Database, Tag, AlertCircle, Activity, FileText,
  TrendingUp, DollarSign, Calendar,
  ShoppingBag, Flame, TrendingDown, Package,
  ShoppingCart, RefreshCw, Copy,
  Users, Key, CreditCard, LogOut, UserCircle, Gauge
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
  SidebarFooter,
} from "@/components/ui/sidebar";

export function AppSidebar() {
  const { open } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname;

  const { data: userRoles } = useQuery({
    queryKey: ["current-user-roles"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      if (error) throw error;
      return data;
    },
  });

  const isSuperUser = userRoles?.some((r: any) => r.role === "super_user");
  const isSeniorUser = userRoles?.some((r: any) => r.role === "senior_user");

  const isActive = (path: string) => {
    return currentPath.startsWith(path);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  // Discovery Sidebar Items
  const discoveryItems = [
    { title: "Products", url: "/discovery/products", icon: Database },
    { title: "Brands", url: "/discovery/brands", icon: Tag },
    { title: "Discovery Queue", url: "/discovery/discovery-queue", icon: AlertCircle },
    { title: "Order Telemetry", url: "/discovery/order-telemetry", icon: Activity, superOnly: true },
    { title: "Feed Imports", url: "/discovery/feed-imports", icon: FileText },
  ];

  // Intelligence Sidebar Items
  const intelligenceItems = [
    { title: "Velocity & Coverage", url: "/intelligence/velocity", icon: TrendingUp },
    { title: "Stock Health", url: "/intelligence/stock-health", icon: Activity },
    { title: "Pricing Signals", url: "/intelligence/pricing", icon: DollarSign },
    { title: "Seasonality", url: "/intelligence/seasonality", icon: Calendar },
  ];

  // Decisions Sidebar Items
  const decisionsItems = [
    { title: "Buy Recommendations", url: "/decisions/buy", icon: ShoppingBag },
    { title: "Liquidation Candidates", url: "/decisions/liquidation", icon: Flame },
    { title: "Price Moves", url: "/decisions/price-moves", icon: TrendingDown },
    { title: "Bundle Suggestions", url: "/decisions/bundles", icon: Package },
  ];

  // Execution Sidebar Items
  const executionItems = [
    { title: "Purchase Order Builder", url: "/execution/purchase-orders", icon: ShoppingCart },
    { title: "Price Push", url: "/execution/price-push", icon: DollarSign },
    { title: "Remote Stock Updates", url: "/execution/remote-stock-updates", icon: RefreshCw },
    { title: "Listing Cloner", url: "/execution/listing-cloner", icon: Copy },
  ];

  // Admin Sidebar Items
  const adminItems = [
    { title: "User Management", url: "/admin/users", icon: Users },
    { title: "API Access", url: "/admin/api-keys", icon: Key },
    { title: "Billing & Usage", url: "/admin/billing", icon: CreditCard },
    { title: "Logs / Diagnostics", url: "/admin/logs", icon: FileText },
  ];

  // Operations Sidebar Items
  const operationsItems = [
    { title: "Order Monitoring", url: "/operations/order-monitoring", icon: Activity },
    { title: "Sync Status", url: "/operations/sync-status", icon: RefreshCw },
    { title: "System Health", url: "/operations/system-health", icon: Gauge },
  ];

  // Determine which sidebar to show based on current path
  const getModuleSidebar = () => {
    if (currentPath.startsWith('/discovery')) {
      return { label: "Discovery", items: discoveryItems };
    }
    if (currentPath.startsWith('/intelligence')) {
      return { label: "Intelligence", items: intelligenceItems };
    }
    if (currentPath.startsWith('/decisions')) {
      return { label: "Decisions", items: decisionsItems };
    }
    if (currentPath.startsWith('/execution')) {
      return { label: "Execution", items: executionItems };
    }
    if (currentPath.startsWith('/operations')) {
      return { label: "Operations", items: operationsItems };
    }
    if (currentPath.startsWith('/admin')) {
      return { label: "Administration", items: adminItems };
    }
    return null;
  };

  const moduleSidebar = getModuleSidebar();

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Main Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={currentPath === "/menu"}>
                  <NavLink to="/menu" end>
                    <Search className="h-4 w-4" />
                    {open && <span>Main Menu</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {moduleSidebar && (
          <SidebarGroup>
            <SidebarGroupLabel>{moduleSidebar.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {moduleSidebar.items
                  .filter(item => !(item as any).superOnly || isSuperUser)
                  .map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={isActive(item.url)}>
                        <NavLink to={item.url}>
                          <item.icon className="h-4 w-4" />
                          {open && <span>{item.title}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={isActive("/profile")}>
              <NavLink to="/profile">
                <UserCircle className="h-4 w-4" />
                {open && <span>Profile</span>}
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleSignOut}>
              <LogOut className="h-4 w-4" />
              {open && <span>Sign Out</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
