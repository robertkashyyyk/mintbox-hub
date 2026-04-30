import { useState, useEffect } from "react";
import { 
  Search, Database, Tag, AlertCircle, Activity, FileText,
  TrendingUp, DollarSign, Calendar,
  ShoppingBag, Flame, TrendingDown, Package,
  ShoppingCart, RefreshCw, Copy,
  Users, Key, CreditCard, LogOut, UserCircle, Gauge,
  ChevronDown, ChevronRight, LayoutDashboard, Settings,
  Images, Clock, Plug, Truck
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useRbacEnabled } from "@/hooks/useRbacEnabled";
import { RbacSidebar } from "@/components/RbacSidebar";

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

interface NavItem {
  title: string;
  url: string;
  icon: React.ElementType;
  superOnly?: boolean;
}

interface NavGroup {
  label: string;
  basePath: string;
  icon: React.ElementType;
  items: NavItem[];
  requireSenior?: boolean;
  requireSuper?: boolean;
}

export function AppSidebar() {
  // ALL hooks must be called at the top, before any conditional returns
  const { open, state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname;
  const { data: rbacEnabled } = useRbacEnabled();

  // Move useQuery to top (before any conditional return)
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

  // Define navGroups before useState that depends on it
  const navGroups: NavGroup[] = [
    {
      label: "Discovery",
      basePath: "/discovery",
      icon: Database,
      items: [
        { title: "Products", url: "/discovery/products", icon: Database },
        { title: "Brands", url: "/discovery/brands", icon: Tag },
        { title: "Discovery Queue", url: "/discovery/discovery-queue", icon: AlertCircle },
        { title: "Feed Imports", url: "/discovery/feed-imports", icon: FileText },
        { title: "Bulk Image Upload", url: "/discovery/bulk-images", icon: Images },
        { title: "Pending Images", url: "/discovery/pending-images", icon: Clock },
      ],
    },
    {
      label: "Intelligence",
      basePath: "/intelligence",
      icon: TrendingUp,
      items: [
        { title: "Velocity & Coverage", url: "/intelligence/velocity", icon: TrendingUp },
        { title: "Stock Health", url: "/intelligence/stock-health", icon: Activity },
        { title: "Pricing Signals", url: "/intelligence/pricing", icon: DollarSign },
        { title: "Seasonality", url: "/intelligence/seasonality", icon: Calendar },
      ],
    },
    {
      label: "Decisions",
      basePath: "/decisions",
      icon: ShoppingBag,
      requireSenior: true,
      items: [
        { title: "Buy Recommendations", url: "/decisions/buying", icon: ShoppingBag },
        { title: "Liquidation Candidates", url: "/decisions/liquidation", icon: Flame },
        { title: "Price Moves", url: "/decisions/price-moves", icon: TrendingDown },
        { title: "Bundle Suggestions", url: "/decisions/bundles", icon: Package },
      ],
    },
    {
      label: "Execution",
      basePath: "/execution",
      icon: ShoppingCart,
      requireSenior: true,
      items: [
        { title: "Purchase Order Builder", url: "/execution/purchase-orders", icon: ShoppingCart },
        { title: "Price Hunter", url: "/execution/price-hunter", icon: DollarSign },
        { title: "Remote Stock Updates", url: "/execution/remote-stock-updates", icon: RefreshCw },
        { title: "Listing Cloner", url: "/execution/listing-cloner", icon: Copy },
      ],
    },
    {
      label: "Operations",
      basePath: "/operations",
      icon: Gauge,
      requireSenior: true,
      items: [
        { title: "Dashboard", url: "/operations/dashboard", icon: LayoutDashboard },
        { title: "Trends", url: "/operations/trends", icon: TrendingUp },
        { title: "SKU Analysis", url: "/operations/sku-analysis", icon: Package },
        { title: "Order Telemetry", url: "/operations/order-telemetry", icon: Activity, superOnly: true },
        { title: "Carriers", url: "/operations/carriers", icon: Truck },
        { title: "Reports", url: "/operations/reports", icon: FileText, superOnly: true },
      ],
    },
    {
      label: "Dashboards",
      basePath: "/dashboards",
      icon: LayoutDashboard,
      requireSenior: true,
      items: [
        { title: "Warehouse Performance", url: "/dashboards/warehouse", icon: LayoutDashboard },
        { title: "Packing Area", url: "/dashboards/packing", icon: Package },
        { title: "Weekly Summary", url: "/dashboards/weekly", icon: TrendingUp },
      ],
    },
    {
      label: "Administration",
      basePath: "/admin",
      icon: Users,
      requireSuper: true,
      items: [
        { title: "User Management", url: "/admin/users", icon: Users },
        { title: "API Access", url: "/admin/api-keys", icon: Key },
        { title: "Billing & Usage", url: "/admin/billing", icon: CreditCard },
        { title: "Logs / Diagnostics", url: "/admin/logs", icon: FileText },
        { title: "System Settings", url: "/admin/settings", icon: Settings },
        { title: "Integrations", url: "/admin/integrations", icon: Plug },
      ],
    },
  ];

  // Track which groups are open
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    // Auto-open the group matching the current path
    const matchingGroup = navGroups.find(g => currentPath.startsWith(g.basePath));
    return matchingGroup ? new Set([matchingGroup.label]) : new Set();
  });

  // Update open groups when path changes
  useEffect(() => {
    const matchingGroup = navGroups.find(g => currentPath.startsWith(g.basePath));
    if (matchingGroup && !openGroups.has(matchingGroup.label)) {
      setOpenGroups(prev => new Set([...prev, matchingGroup.label]));
    }
  }, [currentPath]);

  // NOW conditional return is safe - all hooks already ran
  if (rbacEnabled) {
    return <RbacSidebar />;
  }

  // Non-hook logic after the conditional return
  const isSuperUser = userRoles?.some((r: any) => r.role === "super_user");
  const isSeniorUser = userRoles?.some((r: any) => r.role === "senior_user");
  const isSeniorOrSuper = isSeniorUser || isSuperUser;

  const toggleGroup = (label: string) => {
    setOpenGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(label)) {
        newSet.delete(label);
      } else {
        newSet.add(label);
      }
      return newSet;
    });
  };

  const isActive = (path: string) => currentPath.startsWith(path);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  const shouldShowGroup = (group: NavGroup) => {
    if (group.requireSuper && !isSuperUser) return false;
    if (group.requireSenior && !isSeniorOrSuper) return false;
    return true;
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        {/* Brand Mark */}
        <SidebarGroup>
          <SidebarGroupContent>
            <div className="flex items-center gap-3 px-2 py-3">
              <div className="h-8 w-8 rounded-lg bg-pd-accent flex items-center justify-center flex-shrink-0">
                <span className="text-foreground font-bold text-sm">PD</span>
              </div>
              <div className="group-data-[collapsible=icon]:hidden">
                <p className="text-sm font-semibold text-sidebar-foreground">PartsDoc</p>
                <p className="text-[10px] text-sidebar-foreground/50">Hub</p>
              </div>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Main Menu Link */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={currentPath === "/menu"} tooltip="Main Menu">
                  <NavLink to="/menu" end>
                    <Search className="h-4 w-4" />
                    <span>Main Menu</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Navigation Groups */}
        {collapsed ? (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {navGroups.filter(shouldShowGroup).map((group) => {
                  const firstItem = group.items.find(i => !i.superOnly || isSuperUser);
                  const target = firstItem?.url ?? group.basePath;
                  return (
                    <SidebarMenuItem key={group.label}>
                      <SidebarMenuButton
                        asChild
                        isActive={currentPath.startsWith(group.basePath)}
                        tooltip={group.label}
                      >
                        <NavLink to={target}>
                          <group.icon className="h-4 w-4" />
                          <span>{group.label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          navGroups.filter(shouldShowGroup).map((group) => (
            <SidebarGroup key={group.label}>
              <Collapsible
                open={openGroups.has(group.label)}
                onOpenChange={() => toggleGroup(group.label)}
              >
                <CollapsibleTrigger asChild>
                  <SidebarGroupLabel className="cursor-pointer hover:bg-muted/50 rounded-md flex items-center justify-between pr-2">
                    <div className="flex items-center gap-2">
                      <group.icon className="h-4 w-4" />
                      <span>{group.label}</span>
                    </div>
                    {openGroups.has(group.label)
                      ? <ChevronDown className="h-4 w-4" />
                      : <ChevronRight className="h-4 w-4" />}
                  </SidebarGroupLabel>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.items
                        .filter(item => !item.superOnly || isSuperUser)
                        .map((item) => (
                          <SidebarMenuItem key={item.url}>
                            <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                              <NavLink to={item.url}>
                                <item.icon className="h-4 w-4" />
                                <span>{item.title}</span>
                              </NavLink>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </Collapsible>
            </SidebarGroup>
          ))
        )}
      </SidebarContent>
      
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={isActive("/profile")} tooltip="Profile">
              <NavLink to="/profile">
                <UserCircle className="h-4 w-4" />
                <span>Profile</span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={isActive("/settings")} tooltip="Settings">
              <NavLink to="/settings">
                <Settings className="h-4 w-4" />
                <span>Settings</span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleSignOut} tooltip="Sign Out">
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
