"use client";

/**
 * SidebarTasks — All Tasks section for the sidebar.
 * Two separate lists: To-dos (self-assigned) and Tasks (multi-participant).
 * Color coded using the central color system.
 */

import { useState } from "react";
import { format } from "date-fns";
import { ChevronDown, ChevronRight, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { getTaskColorCategory, getCategoryStyles } from "@/lib/colors";
import { type Task } from "@/lib/types";

interface SidebarTasksProps {
    tasks: Task[];
    currentUserId: string;
}

export default function SidebarTasks({ tasks, currentUserId }: SidebarTasksProps) {
    const [todosOpen, setTodosOpen] = useState(true);
    const [tasksOpen, setTasksOpen] = useState(true);

    // Split: to-do = created_by === assigned_to, task = different people
    const todos = tasks.filter(t => {
        const createdId = typeof t.created_by === "object" ? t.created_by.id : t.created_by;
        const assignedId = typeof t.assigned_to === "object" ? t.assigned_to.id : t.assigned_to;
        return createdId === assignedId;
    });

    const multiTasks = tasks.filter(t => {
        const createdId = typeof t.created_by === "object" ? t.created_by.id : t.created_by;
        const assignedId = typeof t.assigned_to === "object" ? t.assigned_to.id : t.assigned_to;
        return createdId !== assignedId;
    });

    return (
        <div className="space-y-1">
            {/* To-dos section */}
            <button
                onClick={() => setTodosOpen(!todosOpen)}
                className="w-full flex items-center justify-between px-2 py-2 rounded-xl text-xs font-bold uppercase tracking-wider text-gray-400 hover:text-gray-600 transition-colors"
            >
                <span className="flex items-center gap-1.5">
                    To-dos
                    {todos.length > 0 && (
                        <span className="aspect-square p-0.5 inline-flex items-center justify-center rounded-full bg-todo-100 text-todo-700 text-[10px] font-bold leading-none">
                            {todos.length}
                        </span>
                    )}
                </span>
                {todosOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>

            {todosOpen && (
                <div className="space-y-0.5 ml-1">
                    {todos.length === 0 ? (
                        <p className="text-[11px] text-gray-400 px-2 py-1.5">No to-dos</p>
                    ) : (
                        todos.slice(0, 8).map(task => (
                            <SidebarTaskItem key={task.id} task={task} currentUserId={currentUserId} />
                        ))
                    )}
                    {todos.length > 8 && (
                        <p className="text-[10px] text-gray-400 px-2 font-medium">+{todos.length - 8} more</p>
                    )}
                </div>
            )}

            {/* Tasks section */}
            <button
                onClick={() => setTasksOpen(!tasksOpen)}
                className="w-full flex items-center justify-between px-2 py-2 rounded-xl text-xs font-bold uppercase tracking-wider text-gray-400 hover:text-gray-600 transition-colors mt-2"
            >
                <span className="flex items-center gap-1.5">
                    Tasks
                    {multiTasks.length > 0 && (
                        <span className="aspect-square p-0.5 inline-flex items-center justify-center rounded-full bg-owned-100 text-owned-700 text-[10px] font-bold leading-none">
                            {multiTasks.length}
                        </span>
                    )}
                </span>
                {tasksOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>

            {tasksOpen && (
                <div className="space-y-0.5 ml-1">
                    {multiTasks.length === 0 ? (
                        <p className="text-[11px] text-gray-400 px-2 py-1.5">No tasks</p>
                    ) : (
                        multiTasks.slice(0, 8).map(task => (
                            <SidebarTaskItem key={task.id} task={task} currentUserId={currentUserId} />
                        ))
                    )}
                    {multiTasks.length > 8 && (
                        <p className="text-[10px] text-gray-400 px-2 font-medium">+{multiTasks.length - 8} more</p>
                    )}
                </div>
            )}
        </div>
    );
}

function SidebarTaskItem({ task, currentUserId }: { task: Task; currentUserId: string }) {
    const category = getTaskColorCategory(task, currentUserId);
    const styles = getCategoryStyles(category);
    const deadline = task.committed_deadline || task.deadline;

    return (
        <div className={cn(
            "flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer group"
        )}>
            <Circle className={cn("w-2.5 h-2.5 shrink-0 fill-current", styles.text)} />
            <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium text-gray-700 truncate group-hover:text-gray-900 transition-colors">
                    {task.title}
                </p>
            </div>
            {deadline && (
                <span className="text-[10px] text-gray-400 shrink-0 font-medium">
                    {format(new Date(deadline), "d MMM")}
                </span>
            )}
        </div>
    );
}
