/**
 * Ambient slide-in task panel (spec §3.1). Two tabs only — Today and Quick Add —
 * deliberately limited in scope. Controlled by TaskDrawerTrigger.
 */
import { Link } from "react-router-dom";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import { TaskCard } from "@/components/tasks/TaskCard";
import { CreateTaskForm } from "@/components/tasks/CreateTaskForm";
import { useTodayTasks, useCompleteTask } from "@/hooks/tasks/useTasks";

interface TaskDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TaskDrawer({ open, onOpenChange }: TaskDrawerProps) {
  const { data: today = [], isLoading } = useTodayTasks();
  const complete = useCompleteTask();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader className="space-y-1">
          <SheetTitle className="flex items-center justify-between">
            Tasks
            <Button variant="ghost" size="sm" asChild className="text-pd-accent">
              <Link to="/tasks" onClick={() => onOpenChange(false)}>
                Open full view <ExternalLink className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </SheetTitle>
          <SheetDescription>Your focus right now — capture and clear.</SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="today" className="mt-4 flex flex-1 flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="quick">Quick Add</TabsTrigger>
          </TabsList>

          <TabsContent value="today" className="flex-1 overflow-hidden">
            <ScrollArea className="h-full pr-3">
              {isLoading ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
              ) : today.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="text-sm font-medium text-foreground">You're all caught up.</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Nothing overdue or due today.
                  </p>
                </div>
              ) : (
                <div className="space-y-2 py-2">
                  {today.map((task) => (
                    <TaskCard key={task.id} task={task} onComplete={complete} compact />
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="quick" className="flex-1 overflow-y-auto">
            <div className="py-2">
              <CreateTaskForm compact onCreated={() => onOpenChange(false)} />
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
