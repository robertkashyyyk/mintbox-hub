/**
 * Dedicated full-form Create Task page (spec §4). The drawer's Quick Add uses
 * the same CreateTaskForm in compact mode; here we show every field.
 */
import { useNavigate } from "react-router-dom";
import { CreateTaskForm } from "@/components/tasks/CreateTaskForm";

const TaskNew = () => {
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-teal-50">New Task</h1>
        <p className="mt-1 text-sm text-teal-200/60">
          Set a human priority — urgency is calculated for you.
        </p>
      </header>
      <div className="rounded-xl border border-teal-400/15 bg-[hsl(185,55%,12%)] p-5">
        <CreateTaskForm onCreated={() => navigate("/tasks")} />
      </div>
    </div>
  );
};

export default TaskNew;
