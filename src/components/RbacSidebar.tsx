import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import * as Icons from "lucide-react";
import { LucideIcon, Home, LogOut, User, Settings, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMenuForUser, MenuGroup } from "@/hooks/useMenuForUser";
import { NavLink } from "@/components/NavLink";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";

// Icon map for dynamic icon lookup - includes Settings
const iconMap: Record<string, LucideIcon> = {
  Search: Icons.Search,
  Package: Icons.Package,
  Tags: Icons.Tags,
  ListTodo: Icons.ListTodo,
  Upload: Icons.Upload,
  Brain: Icons.Brain,
  TrendingUp: Icons.TrendingUp,
  HeartPulse: Icons.HeartPulse,
  DollarSign: Icons.DollarSign,
  Calendar: Icons.Calendar,
  Scale: Icons.Scale,
  ShoppingCart: Icons.ShoppingCart,
  Trash2: Icons.Trash2,
  ArrowUpDown: Icons.ArrowUpDown,
  Package2: Icons.Package2,
  Zap: Icons.Zap,
  Crosshair: Icons.Crosshair,
  RefreshCw: Icons.RefreshCw,
  Copy: Icons.Copy,
  ClipboardList: Icons.ClipboardList,
  Activity: Icons.Activity,
  LayoutDashboard: Icons.LayoutDashboard,
  FileText: Icons.FileText,
  Monitor: Icons.Monitor,
  Shield: Icons.Shield,
  Users: Icons.Users,
  Key: Icons.Key,
  CreditCard: Icons.CreditCard,
  Terminal: Icons.Terminal,
  Warehouse: Icons.Warehouse,
  CalendarDays: Icons.CalendarDays,
  Settings: Icons.Settings,
};

const getIcon = (iconName: string | null): LucideIcon => {
  if (!iconName) return Home;
  const IconComponent = iconMap[iconName];
  return IconComponent || Home;
};

export const RbacSidebar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: menuGroups, isLoading } = useMenuForUser();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  // Initialize open state for group containing current route
  useEffect(() => {
    if (!menuGroups) return;
    
    const newOpenGroups: Record<string, boolean> = {};
    
    for (const group of menuGroups) {
      const isActiveGroup = group.items.some(
        item => item.routePath && location.pathname.startsWith(item.routePath)
      ) || (group.routePath && location.pathname.startsWith(group.routePath));
      
      if (isActiveGroup) {
        newOpenGroups[group.key] = true;
      }
    }
    
    setOpenGroups(prev => ({ ...prev, ...newOpenGroups }));
  }, [menuGroups, location.pathname]);

  const toggleGroup = (key: string) => {
    setOpenGroups(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  if (isLoading) {
    return (
      <Sidebar>
        <SidebarContent className="pt-4">
          <div className="px-4 space-y-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </div>
        </SidebarContent>
      </Sidebar>
    );
  }

  return (
    <Sidebar>
      <SidebarContent>
        {/* Main Menu Link */}
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <NavLink
                  to="/menu"
                  end
                  className="flex items-center gap-2"
                  activeClassName="bg-accent text-accent-foreground"
                >
                  <Home className="h-4 w-4" />
                  <span>Main Menu</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        {/* Dynamic Menu Groups from RBAC */}
        {menuGroups?.map((group) => {
          const GroupIcon = getIcon(group.iconName);
          const isOpen = openGroups[group.key] ?? false;
          
          // If group has no children, render as direct link
          if (group.items.length === 0 && group.routePath) {
            return (
              <SidebarGroup key={group.key}>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={group.routePath}
                        className="flex items-center gap-2"
                        activeClassName="bg-accent text-accent-foreground"
                      >
                        <GroupIcon className="h-4 w-4" />
                        <span>{group.label}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroup>
            );
          }

          return (
            <SidebarGroup key={group.key}>
              <Collapsible open={isOpen} onOpenChange={() => toggleGroup(group.key)}>
                {/* Group header: text is clickable link, chevron toggles collapse */}
                <SidebarGroupLabel className="flex items-center justify-between pr-2 hover:bg-accent/50 rounded-md transition-colors">
                  {group.routePath ? (
                    <NavLink
                      to={group.routePath}
                      className="flex items-center gap-2 flex-1 py-1"
                      activeClassName="text-primary font-medium"
                    >
                      <GroupIcon className="h-4 w-4" />
                      <span>{group.label}</span>
                    </NavLink>
                  ) : (
                    <span className="flex items-center gap-2 flex-1">
                      <GroupIcon className="h-4 w-4" />
                      {group.label}
                    </span>
                  )}
                  <CollapsibleTrigger asChild>
                    <button 
                      className="p-1 hover:bg-muted rounded transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ChevronRight 
                        className={cn(
                          "h-4 w-4 transition-transform",
                          isOpen && "rotate-90"
                        )} 
                      />
                    </button>
                  </CollapsibleTrigger>
                </SidebarGroupLabel>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.items.map((item) => {
                        const ItemIcon = getIcon(item.iconName);
                        
                        return (
                          <SidebarMenuItem key={item.key}>
                            <SidebarMenuButton asChild>
                              <NavLink
                                to={item.routePath || '#'}
                                className="flex items-center gap-2"
                                activeClassName="bg-accent text-accent-foreground"
                              >
                                <ItemIcon className="h-4 w-4" />
                                <span>{item.label}</span>
                              </NavLink>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </Collapsible>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <NavLink
                to="/profile"
                className="flex items-center gap-2"
                activeClassName="bg-accent text-accent-foreground"
              >
                <User className="h-4 w-4" />
                <span>Profile</span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <NavLink
                to="/settings"
                className="flex items-center gap-2"
                activeClassName="bg-accent text-accent-foreground"
              >
                <Settings className="h-4 w-4" />
                <span>Settings</span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={handleSignOut}
              className="flex items-center gap-2 text-destructive hover:text-destructive"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
};
