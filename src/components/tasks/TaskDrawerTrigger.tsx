/**
 * Header icon that opens the ambient Task Drawer, carrying a live badge count of
 * the user's open tasks updated in real time via Supabase Realtime (spec §3.1).
 * Drop into any layout header next to the notification bell.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckSquare } from "lucide-react";
import { TaskDrawer } from "@/components/tasks/TaskDrawer";
import { useOpenTaskCount } from "@/hooks/tasks/useTasks";

export function TaskDrawerTrigger() {
  const [open, setOpen] = useState(false);
  const { data: count = 0 } = useOpenTaskCount();

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="relative text-muted-foreground hover:text-foreground"
        title="Tasks"
        onClick={() => setOpen(true)}
      >
        <CheckSquare className="h-5 w-5" />
        {count > 0 && (
          <Badge
            variant="destructive"
            className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center p-0 text-xs"
          >
            {count > 99 ? "99+" : count}
          </Badge>
        )}
      </Button>
      <TaskDrawer open={open} onOpenChange={setOpen} />
    </>
  );
}
