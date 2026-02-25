"use client";

import { useState, useMemo, useCallback } from "react";
import { type Task } from "@/lib/types";
import TaskCard from "@/components/dashboard/TaskCard";
import { getTaskColorCategory, getTaskTags } from "@/lib/colors";
import { Plus, User, Clock, AlertCircle, Crown, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import CreateTaskModal from "./CreateTaskModal";
import {
    extractUserId,
    getPendingInfo,
} from "@/lib/task-service";

interface AllTasksClientProps {
    todos: Task[];
    tasks: Task[];
    currentUserId: string;
    allOrgTasks: Task[];
}

export default function AllTasksClient({ todos, tasks, currentUserId, allOrgTasks }: AllTasksClientProps) {
    const [activeTab, setActiveTab] = useState<"todos" | "tasks">("tasks"); // default to tasks
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [taskFilters, setTaskFilters] = useState<Set<string>>(new Set());
    const [todoFilters, setTodoFilters] = useState<Set<string>>(new Set());

    // ── Per-task filter predicates ──
    const isOwnedByMe = useCallback((t: Task) => {
        const creatorId = extractUserId(t.created_by);
        const assigneeId = extractUserId(t.assigned_to);
        return creatorId === currentUserId && assigneeId !== currentUserId;
    }, [currentUserId]);

    const isPendingActionFromMe = useCallback((t: Task) => {
        const pending = getPendingInfo(t, currentUserId, allOrgTasks);
        return pending.isPending && pending.isPendingFromMe;
    }, [currentUserId, allOrgTasks]);

    const isAssignedToMe = useCallback((t: Task) => {
        const creatorId = extractUserId(t.created_by);
        return creatorId !== currentUserId;
    }, [currentUserId]);

    const isWaitingOnOthers = useCallback((t: Task) => {
        const pending = getPendingInfo(t, currentUserId, allOrgTasks);
        return pending.isPending && !pending.isPendingFromMe;
    }, [currentUserId, allOrgTasks]);

    const isOverdueTask = useCallback((t: Task) => {
        const dl = t.committed_deadline || t.deadline;
        if (!dl) return false;
        const now = new Date();
        return t.status === "overdue" || (new Date(dl) < now && t.status !== "completed");
    }, []);

    // Map filter keys to their predicate functions
    const filterPredicates: Record<string, (t: Task) => boolean> = useMemo(() => ({
        owned: isOwnedByMe,
        pending_action: isPendingActionFromMe,
        assigned: isAssignedToMe,
        waiting: isWaitingOnOthers,
        overdue: isOverdueTask,
    }), [isOwnedByMe, isPendingActionFromMe, isAssignedToMe, isWaitingOnOthers, isOverdueTask]);

    // Memoize the filtering logic — uses INTERSECTION for multi-select
    const { displayTasks, displayTodos } = useMemo(() => {
        let filteredTasks: Task[];
        if (taskFilters.size === 0) {
            filteredTasks = tasks;
        } else {
            const activePredicates = Array.from(taskFilters)
                .map(f => filterPredicates[f])
                .filter(Boolean);
            filteredTasks = tasks.filter(t =>
                activePredicates.every(pred => pred(t))
            );
        }

        let filteredTodos: Task[];
        if (todoFilters.size === 0) {
            filteredTodos = todos;
        } else {
            filteredTodos = todos.filter(t => {
                if (todoFilters.has('overdue')) {
                    return isOverdueTask(t);
                }
                return false;
            });
        }

        return { displayTasks: filteredTasks, displayTodos: filteredTodos };
    }, [taskFilters, todoFilters, tasks, todos, filterPredicates, isOverdueTask]);

    const toggleFilter = (filter: string, isTaskFilter: boolean) => {
        if (isTaskFilter) {
            setTaskFilters(prev => {
                const next = new Set(prev);
                if (next.has(filter)) next.delete(filter);
                else next.add(filter);
                return next;
            });
        } else {
            setTodoFilters(prev => {
                const next = new Set(prev);
                if (next.has(filter)) next.delete(filter);
                else next.add(filter);
                return next;
            });
        }
    };

    return (
        <div className="max-w-3xl animate-fade-in-up pb-56">
            <div className="flex flex-row items-center justify-between gap-4 mb-6 relative z-50 px-1">
                <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">
                    All Tasks
                </h1>

                <div className="flex items-center gap-3 w-auto space-x-0">
                    <button
                        onClick={() => setIsCreateModalOpen(true)}
                        className="shrink-0 flex items-center justify-center p-2.5 sm:px-4 sm:py-2.5 bg-gray-900 text-white rounded-xl hover:bg-gray-800 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
                    >
                        <Plus className="w-5 h-5 sm:mr-2" />
                        <span className="hidden sm:inline font-semibold text-sm">Create Task</span>
                    </button>
                </div>
            </div>

            {/* Horizontal Toggles */}
            <div className="flex bg-gray-100 rounded-xl p-1 mb-8">
                <button
                    onClick={() => setActiveTab("tasks")}
                    className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all duration-200",
                        activeTab === "tasks"
                            ? "bg-gray-900 text-white shadow-sm"
                            : "text-gray-500 hover:text-gray-700"
                    )}
                >
                    Tasks
                    <span className={cn(
                        "aspect-square p-1 inline-flex items-center justify-center text-[10px] font-bold rounded-full leading-none",
                        activeTab === "tasks" ? "bg-white text-gray-900" : "bg-gray-200 text-gray-600"
                    )}>
                        {tasks.length}
                    </span>
                </button>
                <button
                    onClick={() => setActiveTab("todos")}
                    className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all duration-200",
                        activeTab === "todos"
                            ? "bg-gray-900 text-white shadow-sm"
                            : "text-gray-500 hover:text-gray-700"
                    )}
                >
                    To-dos
                    <span className={cn(
                        "aspect-square p-1 inline-flex items-center justify-center text-[10px] font-bold rounded-full leading-none",
                        activeTab === "todos" ? "bg-white text-gray-900" : "bg-gray-200 text-gray-600"
                    )}>
                        {todos.length}
                    </span>
                </button>
            </div>

            {/* Content Area */}
            {activeTab === "tasks" ? (
                <div className="space-y-4">
                    {/* Task Filters */}
                    <div className="space-y-1.5 sm:space-y-2 w-full">
                        {/* Row 1: Owned + Pending Action */}
                        <div className="flex gap-1.5 sm:gap-2 items-center w-full">
                            <button
                                onClick={() => toggleFilter('owned', true)}
                                className={cn(
                                    "flex-1 px-1 py-1.5 sm:px-3.5 sm:py-1.5 rounded-xl sm:rounded-full text-[9px] sm:text-xs font-bold flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 transition-all duration-200 border backdrop-blur-sm text-center leading-tight",
                                    taskFilters.has('owned')
                                        ? "bg-owned-100 text-owned-700 border-owned-200 shadow-md"
                                        : "bg-white/70 text-gray-700 border-white/50 hover:bg-white/90 shadow-sm"
                                )}
                            >
                                <Crown className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                                <span className="truncate w-full sm:w-auto">Owned</span>
                            </button>
                            <button
                                onClick={() => toggleFilter('pending_action', true)}
                                className={cn(
                                    "flex-1 px-1 py-1.5 sm:px-3.5 sm:py-1.5 rounded-xl sm:rounded-full text-[9px] sm:text-xs font-bold flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 transition-all duration-200 border backdrop-blur-sm text-center leading-tight",
                                    taskFilters.has('pending_action')
                                        ? "bg-amber-100 text-amber-700 border-amber-200 shadow-md"
                                        : "bg-white/70 text-gray-700 border-white/50 hover:bg-white/90 shadow-sm"
                                )}
                            >
                                <RotateCw className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                                <span className="truncate w-full sm:w-auto">Pending Action</span>
                            </button>
                        </div>
                        {/* Row 2: Assigned + Waiting + Overdue */}
                        <div className="flex gap-1.5 sm:gap-2 items-center w-full">
                            <button
                                onClick={() => toggleFilter('assigned', true)}
                                className={cn(
                                    "flex-1 px-1 py-1.5 sm:px-3.5 sm:py-1.5 rounded-xl sm:rounded-full text-[9px] sm:text-xs font-bold flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 transition-all duration-200 border backdrop-blur-sm text-center leading-tight",
                                    taskFilters.has('assigned')
                                        ? "bg-assigned-100 text-assigned-700 border-assigned-200 shadow-md"
                                        : "bg-white/70 text-gray-700 border-white/50 hover:bg-white/90 shadow-sm"
                                )}
                            >
                                <User className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                                <span className="truncate w-full sm:w-auto">Assigned</span>
                            </button>
                            <button
                                onClick={() => toggleFilter('waiting', true)}
                                className={cn(
                                    "flex-1 px-1 py-1.5 sm:px-3.5 sm:py-1.5 rounded-xl sm:rounded-full text-[9px] sm:text-xs font-bold flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 transition-all duration-200 border backdrop-blur-sm text-center leading-tight",
                                    taskFilters.has('waiting')
                                        ? "bg-amber-100 text-amber-700 border-amber-200 shadow-md"
                                        : "bg-white/70 text-gray-700 border-white/50 hover:bg-white/90 shadow-sm"
                                )}
                            >
                                <Clock className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                                <span className="truncate w-full sm:w-auto">Waiting</span>
                            </button>
                            <button
                                onClick={() => toggleFilter('overdue', true)}
                                className={cn(
                                    "flex-1 px-1 py-1.5 sm:px-3.5 sm:py-1.5 rounded-xl sm:rounded-full text-[9px] sm:text-xs font-bold flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 transition-all duration-200 border backdrop-blur-sm text-center leading-tight",
                                    taskFilters.has('overdue')
                                        ? "bg-overdue-100 text-overdue-700 border-overdue-200 shadow-md"
                                        : "bg-white/70 text-gray-700 border-white/50 hover:bg-white/90 shadow-sm"
                                )}
                            >
                                <AlertCircle className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                                <span className="truncate w-full sm:w-auto">Overdue</span>
                            </button>
                        </div>
                    </div>

                    {/* Task List */}
                    <div className="space-y-3">
                        {displayTasks.length === 0 ? (
                            <div className="p-8 text-center bg-gray-50 rounded-2xl border border-gray-100">
                                <p className="text-sm text-gray-500 font-medium">
                                    {taskFilters.size > 0
                                        ? "No tasks match the selected filters."
                                        : "No tasks found."}
                                </p>
                            </div>
                        ) : (
                            displayTasks.map(task => (
                                <TaskCard
                                    key={task.id}
                                    task={task}
                                    category={getTaskColorCategory(task, currentUserId)}
                                    currentUserId={currentUserId}
                                    tags={getTaskTags(task, currentUserId)}
                                />
                            ))
                        )}
                    </div>
                </div>
            ) : (
                <div className="space-y-4">
                    {/* Todo Filters */}
                    <div className="flex gap-1.5 sm:gap-2 items-center w-full">
                        <button
                            onClick={() => toggleFilter('overdue', false)}
                            className={cn(
                                "flex-1 sm:flex-none px-2 py-1.5 sm:px-3.5 sm:py-1.5 rounded-xl sm:rounded-full text-[10px] sm:text-xs font-bold flex items-center justify-center gap-1 sm:gap-1.5 transition-all duration-200 border backdrop-blur-sm",
                                todoFilters.has('overdue')
                                    ? "bg-overdue-100 text-overdue-700 border-overdue-200 shadow-md"
                                    : "bg-white/70 text-gray-700 border-white/50 hover:bg-white/90 shadow-sm"
                            )}
                        >
                            <AlertCircle className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                            Overdue
                        </button>
                    </div>

                    {/* Todo List */}
                    <div className="space-y-3">
                        {displayTodos.length === 0 ? (
                            <div className="p-8 text-center bg-gray-50 rounded-2xl border border-gray-100">
                                <p className="text-sm text-gray-500 font-medium">
                                    {todoFilters.size > 0
                                        ? "No to-dos match the selected filters."
                                        : "No to-dos found."}
                                </p>
                            </div>
                        ) : (
                            displayTodos.map(todo => (
                                <TaskCard
                                    key={todo.id}
                                    task={todo}
                                    category={getTaskColorCategory(todo, currentUserId)}
                                    currentUserId={currentUserId}
                                    tags={getTaskTags(todo, currentUserId)}
                                />
                            ))
                        )}
                    </div>
                </div>
            )}

            <CreateTaskModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                currentUserId={currentUserId}
            />
        </div>
    );
}
