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
import { toast } from "sonner";
import { Mail, Trash2, UserPlus, KeyRound } from "lucide-react";

type AppRole = "super_user" | "senior_user" | "simple_user";

const UserManagement = () => {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AppRole>("simple_user");
  const queryClient = useQueryClient();

  // Fetch all users with their roles
  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: ["users-with-roles"],
    queryFn: async () => {
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select(`
          *,
          user_roles (role)
        `);

      if (profilesError) throw profilesError;
      return profiles;
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

  // Send invite mutation
  const sendInviteMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Create the invite in the database
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

      // Send the invitation email
      const { error: emailError } = await supabase.functions.invoke("send-invite-email", {
        body: {
          email: inviteEmail,
          role: inviteRole,
          inviteId: invite.id,
        },
      });

      if (emailError) {
        console.error("Failed to send email:", emailError);
        // Don't throw - the invite is created, just log the email error
        throw new Error("Invite created but email failed to send. Please contact the user manually.");
      }

      return invite;
    },
    onSuccess: () => {
      toast.success("Invitation sent successfully! The user will receive an email.");
      setInviteEmail("");
      setInviteRole("simple_user");
      queryClient.invalidateQueries({ queryKey: ["user-invites"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Delete invite mutation
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

  // Update user role mutation
  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, newRole }: { userId: string; newRole: AppRole }) => {
      // Delete existing role
      await supabase.from("user_roles").delete().eq("user_id", userId);

      // Insert new role
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

  // Send password reset mutation
  const sendPasswordResetMutation = useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth?mode=reset`,
      });
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Password reset email sent successfully");
    },
    onError: (error: Error) => {
      toast.error(`Failed to send password reset: ${error.message}`);
    },
  });

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">User Management</h1>
        <p className="text-muted-foreground mt-2">
          Manage user invitations and roles
        </p>
      </div>

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

      {/* All Users */}
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
                    <TableHead>Role</TableHead>
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
                            Reset Password
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
    </div>
  );
};

export default UserManagement;
