import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Plus, Trash2, Mail, Clock, CheckCircle, XCircle, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

interface Subscriber {
  id: string; name: string; email: string; enabled: boolean; report_type: string; created_at: string;
}
interface ReportLog {
  id: string; report_type: string; sent_at: string; recipients_count: number; status: string; error_message: string | null; week_ending: string | null;
}

const OpsReports = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");

  const { data: subscribers, isLoading: subscribersLoading } = useQuery({
    queryKey: ['ops-report-subscribers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ops_report_subscribers').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data as Subscriber[];
    },
  });

  const { data: logs, isLoading: logsLoading } = useQuery({
    queryKey: ['ops-report-logs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ops_report_log').select('*').order('sent_at', { ascending: false }).limit(20);
      if (error) throw error;
      return data as ReportLog[];
    },
  });

  const addSubscriber = useMutation({
    mutationFn: async ({ name, email }: { name: string; email: string }) => {
      const { error } = await supabase.from('ops_report_subscribers').insert({ name, email, report_type: 'weekly' });
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ops-report-subscribers'] }); toast.success("Subscriber added"); setIsAddDialogOpen(false); setNewName(""); setNewEmail(""); },
    onError: (error: any) => { toast.error(error.message || "Failed to add subscriber"); },
  });

  const toggleSubscriber = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase.from('ops_report_subscribers').update({ enabled }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ops-report-subscribers'] }); },
    onError: (error: any) => { toast.error(error.message || "Failed to update subscriber"); },
  });

  const deleteSubscriber = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('ops_report_subscribers').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ops-report-subscribers'] }); toast.success("Subscriber removed"); },
    onError: (error: any) => { toast.error(error.message || "Failed to remove subscriber"); },
  });

  const sendTestReport = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke('send-ops-weekly-report', { body: { test: true } });
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ops-report-logs'] }); toast.success("Test report sent"); },
    onError: (error: any) => { toast.error(error.message || "Failed to send test report"); },
  });

  const handleAddSubscriber = () => {
    if (!newName.trim() || !newEmail.trim()) { toast.error("Name and email are required"); return; }
    addSubscriber.mutate({ name: newName.trim(), email: newEmail.trim() });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" className="text-pd-accent hover:text-pd-accent-light" onClick={() => navigate("/operations")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-white">Operations Reports</h1>
            <p className="text-sm text-white/60">Manage weekly report subscribers and view send history</p>
          </div>
        </div>
        <Button variant="outlineDark" onClick={() => sendTestReport.mutate()} disabled={sendTestReport.isPending}>
          <Send className="h-4 w-4 mr-2" />
          {sendTestReport.isPending ? "Sending..." : "Send Test Report"}
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5" />Report Subscribers</CardTitle>
            <CardDescription>Weekly ops report sent Friday 16:45 UK time</CardDescription>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-2" />Add Subscriber</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Subscriber</DialogTitle>
                <DialogDescription>Add a new recipient for the weekly operations report.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2"><Label htmlFor="name">Name</Label><Input id="name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="John Smith" /></div>
                <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="john@example.com" /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleAddSubscriber} disabled={addSubscriber.isPending}>{addSubscriber.isPending ? "Adding..." : "Add Subscriber"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {subscribersLoading ? (
            <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
          ) : subscribers && subscribers.length > 0 ? (
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Enabled</TableHead><TableHead className="w-[100px]">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {subscribers.map((sub) => (
                  <TableRow key={sub.id}>
                    <TableCell className="font-medium">{sub.name}</TableCell>
                    <TableCell>{sub.email}</TableCell>
                    <TableCell><Switch checked={sub.enabled} onCheckedChange={(checked) => toggleSubscriber.mutate({ id: sub.id, enabled: checked })} /></TableCell>
                    <TableCell><Button variant="ghost" size="icon" onClick={() => deleteSubscriber.mutate(sub.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-center py-8">No subscribers yet. Add subscribers to receive the weekly ops report.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5" />Send History</CardTitle>
          <CardDescription>Recent report sends and their status</CardDescription>
        </CardHeader>
        <CardContent>
          {logsLoading ? (
            <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
          ) : logs && logs.length > 0 ? (
            <Table>
              <TableHeader><TableRow><TableHead>Sent At</TableHead><TableHead>Week Ending</TableHead><TableHead>Recipients</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>{format(new Date(log.sent_at), 'dd MMM yyyy HH:mm')}</TableCell>
                    <TableCell>{log.week_ending ? format(new Date(log.week_ending), 'dd MMM yyyy') : '—'}</TableCell>
                    <TableCell>{log.recipients_count}</TableCell>
                    <TableCell>
                      {log.status === 'success' ? (
                        <span className="flex items-center gap-1 text-green-600"><CheckCircle className="h-4 w-4" />Success</span>
                      ) : (
                        <span className="flex items-center gap-1 text-destructive"><XCircle className="h-4 w-4" />{log.error_message || 'Failed'}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-center py-8">No reports have been sent yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default OpsReports;
