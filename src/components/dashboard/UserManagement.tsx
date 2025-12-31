import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Mail, Trash2, UserPlus, KeyRound, AlertTriangle, Shield } from "lucide-react";
import { 
  useUserRbacRoles, 
  useRoleConflicts,
  useAssignRbacRole,
  useRemoveRbacRole,
  useCheckRoleConflict,
  RbacRole,
  RBAC_ROLE_LABELS,
} from "@/hooks/useUserRbacRoles";

type AppRole = "super_user" | "senior_user" | "simple_user";

const ALL_RBAC_ROLES: RbacRole[] = [
  'systems_controller',
  'commercial_governor',
  'inventory_steward',
  'operations_steward',
  'execution_operator',
  'customer_service_operator',
  'finance_governor',
  'executive_viewer',
];

const UserManagement = () => {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AppRole>("simple_user");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Fetch all users with their roles
  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: ["users-with-roles"],
    queryFn: async () => {
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("*");

      if (profilesError) throw profilesError;

      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("*");

      if (rolesError) throw rolesError;

      const { data: rbacRoles, error: rbacError } = await supabase
        .from("user_rbac_roles")
        .select("*")
        .eq("is_active", true);

      if (rbacError) throw rbacError;

      return profiles?.map(profile => ({
        ...profile,
        user_roles: roles?.filter(r => r.user_id === profile.id) || [],
        rbac_roles: rbacRoles?.filter(r => r.user_id === profile.id) || [],
      })) || [];
    },
  });

  // Fetch pending invites
  const { data: invites, isLoading: invitesLoading } = useQuery({
    queryKey: ["user-invites"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_invites")
        .select("*")
        .eq("used", false)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  const { data: roleConflicts } = useRoleConflicts();
  const assignRbacRole = useAssignRbacRole();
  const removeRbacRole = useRemoveRbacRole();
  const checkConflict = useCheckRoleConflict();

  // Send invite mutation
  const sendInviteMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: invite, error: inviteError } = await supabase
        .from("user_invites")
        .insert({
          email: inviteEmail,
          role: inviteRole,
          invited_by: user.id,
        })
        .select()
        .single();

      if (inviteError) throw inviteError;

      const { error: emailError } = await supabase.functions.invoke("send-invite-email", {
        body: {
          email: inviteEmail,
          role: inviteRole,
          inviteId: invite.id,
        },
      });

      if (emailError) {
        throw new Error("Invite created but email failed to send.");
      }

      return invite;
    },
    onSuccess: () => {
      toast.success("Invitation sent successfully!");
      setInviteEmail("");
      setInviteRole("simple_user");
      queryClient.invalidateQueries({ queryKey: ["user-invites"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const deleteInviteMutation = useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase
        .from("user_invites")
        .delete()
        .eq("id", inviteId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Invitation deleted");
      queryClient.invalidateQueries({ queryKey: ["user-invites"] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete invite: ${error.message}`);
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, newRole }: { userId: string; newRole: AppRole }) => {
      await supabase.from("user_roles").delete().eq("user_id", userId);
      const { error } = await supabase
        .from("user_roles")
        .insert({ user_id: userId, role: newRole });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("User role updated");
      queryClient.invalidateQueries({ queryKey: ["users-with-roles"] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to update role: ${error.message}`);
    },
  });

  const sendPasswordResetMutation = useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth?mode=reset`,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Password reset email sent");
    },
    onError: (error: Error) => {
      toast.error(`Failed to send password reset: ${error.message}`);
    },
  });

  const handleRbacRoleToggle = async (userId: string, role: RbacRole, currentRoles: RbacRole[]) => {
    const hasRole = currentRoles.includes(role);

    if (hasRole) {
      removeRbacRole.mutate(
        { userId, role },
        {
          onSuccess: () => {
            toast.success(`Removed ${RBAC_ROLE_LABELS[role].label}`);
            queryClient.invalidateQueries({ queryKey: ["users-with-roles"] });
          },
          onError: (error) => {
            toast.error(`Failed to remove role: ${error.message}`);
          },
        }
      );
    } else {
      const conflict = checkConflict(currentRoles, role);
      if (conflict) {
        toast.error(`Cannot assign: ${conflict.reason}`);
        return;
      }

      assignRbacRole.mutate(
        { userId, role },
        {
          onSuccess: () => {
            toast.success(`Assigned ${RBAC_ROLE_LABELS[role].label}`);
            queryClient.invalidateQueries({ queryKey: ["users-with-roles"] });
          },
          onError: (error) => {
            toast.error(`Failed to assign role: ${error.message}`);
          },
        }
      );
    }
  };

  const getRoleBadge = (role: AppRole) => {
    const variants = {
      super_user: "destructive",
      senior_user: "default",
      simple_user: "secondary",
    } as const;

    const labels = {
      super_user: "Super User",
      senior_user: "Senior User",
      simple_user: "Simple User",
    };

    return <Badge variant={variants[role]}>{labels[role]}</Badge>;
  };

  const getRbacRoleBadge = (role: RbacRole) => {
    return (
      <Badge variant="outline" className="text-xs">
        {RBAC_ROLE_LABELS[role].label}
      </Badge>
    );
  };

  const selectedUser = users?.find(u => u.id === selectedUserId);
  const selectedUserRbacRoles = selectedUser?.rbac_roles?.map((r: any) => r.role as RbacRole) || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">User Management</h1>
        <p className="text-muted-foreground mt-2">
          Manage user invitations and roles
        </p>
      </div>

      <Tabs defaultValue="legacy">
        <TabsList>
          <TabsTrigger value="legacy">Legacy Roles</TabsTrigger>
          <TabsTrigger value="rbac">RBAC Roles</TabsTrigger>
        </TabsList>

        <TabsContent value="legacy" className="space-y-6">
          {/* Send Invitation */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5" />
                Invite New User
              </CardTitle>
              <CardDescription>
                Send an invitation to a new user with a specific role
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="user@example.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="role">Role</Label>
                    <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as AppRole)}>
                      <SelectTrigger id="role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="simple_user">Simple User</SelectItem>
                        <SelectItem value="senior_user">Senior User</SelectItem>
                        <SelectItem value="super_user">Super User</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button
                  onClick={() => sendInviteMutation.mutate()}
                  disabled={!inviteEmail || sendInviteMutation.isPending}
                  className="w-full md:w-auto"
                >
                  <Mail className="mr-2 h-4 w-4" />
                  {sendInviteMutation.isPending ? "Sending..." : "Send Invitation"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Pending Invitations */}
          <Card>
            <CardHeader>
              <CardTitle>Pending Invitations ({invites?.length || 0})</CardTitle>
            </CardHeader>
            <CardContent>
              {invitesLoading ? (
                <p className="text-muted-foreground">Loading invitations...</p>
              ) : invites && invites.length > 0 ? (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Expires</TableHead>
                        <TableHead className="w-[100px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invites.map((invite) => (
                        <TableRow key={invite.id}>
                          <TableCell className="font-medium">{invite.email}</TableCell>
                          <TableCell>{getRoleBadge(invite.role)}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(invite.expires_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteInviteMutation.mutate(invite.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-center py-8 text-muted-foreground">
                  No pending invitations
                </p>
              )}
            </CardContent>
          </Card>

          {/* All Users - Legacy */}
          <Card>
            <CardHeader>
              <CardTitle>All Users ({users?.length || 0})</CardTitle>
            </CardHeader>
            <CardContent>
              {usersLoading ? (
                <p className="text-muted-foreground">Loading users...</p>
              ) : users && users.length > 0 ? (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Legacy Role</TableHead>
                        <TableHead>Change Role</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((user: any) => {
                        const userRoles = user.user_roles || [];
                        const currentRole = userRoles.length > 0 ? userRoles[0].role : undefined;
                        
                        return (
                          <TableRow key={user.id}>
                            <TableCell className="font-medium">{user.email}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {user.full_name || "—"}
                            </TableCell>
                            <TableCell>
                              {currentRole ? getRoleBadge(currentRole) : <Badge variant="outline">No Role</Badge>}
                            </TableCell>
                            <TableCell>
                              <Select
                                value={currentRole || ""}
                                onValueChange={(value) =>
                                  updateRoleMutation.mutate({
                                    userId: user.id,
                                    newRole: value as AppRole,
                                  })
                                }
                              >
                                <SelectTrigger className="w-[180px]">
                                  <SelectValue placeholder="Select role" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="simple_user">Simple User</SelectItem>
                                  <SelectItem value="senior_user">Senior User</SelectItem>
                                  <SelectItem value="super_user">Super User</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => sendPasswordResetMutation.mutate(user.email)}
                                disabled={sendPasswordResetMutation.isPending}
                              >
                                <KeyRound className="h-4 w-4 mr-2" />
                                Reset
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-center py-8 text-muted-foreground">No users found</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rbac" className="space-y-6">
          <Alert>
            <Shield className="h-4 w-4" />
            <AlertTitle>Constitutional RBAC System</AlertTitle>
            <AlertDescription>
              Assign multiple roles to users. Constitutional conflicts are enforced automatically.
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* User List */}
            <Card>
              <CardHeader>
                <CardTitle>Select User</CardTitle>
              </CardHeader>
              <CardContent>
                {usersLoading ? (
                  <p className="text-muted-foreground">Loading...</p>
                ) : (
                  <div className="space-y-2">
                    {users?.map((user: any) => (
                      <div
                        key={user.id}
                        className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                          selectedUserId === user.id 
                            ? 'border-primary bg-primary/5' 
                            : 'hover:bg-muted/50'
                        }`}
                        onClick={() => setSelectedUserId(user.id)}
                      >
                        <div className="font-medium">{user.email}</div>
                        <div className="text-sm text-muted-foreground">{user.full_name || "No name"}</div>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {user.rbac_roles?.map((r: any) => (
                            <Badge key={r.id} variant="secondary" className="text-xs">
                              {RBAC_ROLE_LABELS[r.role as RbacRole]?.label}
                            </Badge>
                          ))}
                          {(!user.rbac_roles || user.rbac_roles.length === 0) && (
                            <span className="text-xs text-muted-foreground">No RBAC roles</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Role Assignment */}
            <Card>
              <CardHeader>
                <CardTitle>
                  {selectedUser ? `Roles for ${selectedUser.email}` : 'Select a user'}
                </CardTitle>
                <CardDescription>
                  Check roles to assign. Conflicts are blocked automatically.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {selectedUser ? (
                  <div className="space-y-4">
                    {ALL_RBAC_ROLES.map((role) => {
                      const hasRole = selectedUserRbacRoles.includes(role);
                      const conflict = !hasRole ? checkConflict(selectedUserRbacRoles, role) : null;
                      const isDisabled = assignRbacRole.isPending || removeRbacRole.isPending;

                      return (
                        <div key={role} className="flex items-start space-x-3">
                          <Checkbox
                            id={role}
                            checked={hasRole}
                            disabled={isDisabled || !!conflict}
                            onCheckedChange={() => handleRbacRoleToggle(selectedUser.id, role, selectedUserRbacRoles)}
                          />
                          <div className="flex-1">
                            <label
                              htmlFor={role}
                              className={`font-medium cursor-pointer ${conflict ? 'text-muted-foreground' : ''}`}
                            >
                              {RBAC_ROLE_LABELS[role].label}
                            </label>
                            <p className="text-sm text-muted-foreground">
                              {RBAC_ROLE_LABELS[role].description}
                            </p>
                            {conflict && (
                              <div className="flex items-center gap-1 mt-1 text-sm text-destructive">
                                <AlertTriangle className="h-3 w-3" />
                                {conflict.reason}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">
                    Select a user to manage their RBAC roles
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default UserManagement;
