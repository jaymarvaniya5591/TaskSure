"use client";

import { useState, useMemo, useCallback } from "react";
import { format, isToday, startOfDay, endOfDay } from "date-fns";
import WeeklyCalendarStrip from "@/components/dashboard/WeeklyCalendarStrip";
import { type Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import TaskCard from "@/components/dashboard/TaskCard";
import { getTaskColorCategory, getTaskTags } from "@/lib/colors";
import { User, Clock, AlertCircle, CalendarDays, Crown, RotateCw } from "lucide-react";
import {
    extractUserId,
    getPendingInfo,
} from "@/lib/task-service";

interface DashboardClientProps {
    currentUserId: string;
    allTasks: Task[];
    allOrgTasks: Task[];
}

export default function DashboardClient({
    currentUserId,
    allTasks,
    allOrgTasks,
}: DashboardClientProps) {
    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [mainTab, setMainTab] = useState<"tasks" | "todos">("tasks");
    const [taskFilters, setTaskFilters] = useState<Set<string>>(new Set());
    const [todoFilters, setTodoFilters] = useState<Set<string>>(new Set());

    // Determine if today is the selected date (needed for filter logic below)
    const isTodaySelected = isToday(selectedDate);

    // Filter tasks for the selected date
    // Today: show all tasks with deadline ≤ end of today (includes overdue)
    // Other days: show strictly that day's tasks
    const dayEnd = endOfDay(selectedDate);
    const selectedDayTasks = allTasks.filter(t => {
        const dl = t.committed_deadline || t.deadline;
        if (!dl) {
            return isTodaySelected;
        }
        const d = new Date(dl);
        if (isTodaySelected) {
            return d <= dayEnd;
        }
        const dayStart = startOfDay(selectedDate);
        return d >= dayStart && d <= dayEnd;
    });

    const isTodo = (t: Task) => {
        const cId = typeof t.created_by === 'object' && t.created_by !== null && "id" in t.created_by ? (t.created_by as unknown as Record<string, unknown>).id : t.created_by;
        const aId = typeof t.assigned_to === 'object' && t.assigned_to !== null && "id" in t.assigned_to ? (t.assigned_to as unknown as Record<string, unknown>).id : t.assigned_to;
        return cId === aId;
    };

    const todaysTasks = selectedDayTasks.filter(t => !isTodo(t));
    const todaysTodos = selectedDayTasks.filter(t => isTodo(t));

    // ── Per-task filter predicates ──
    // Each returns true if the task matches that filter criterion.
    // A task can match multiple filters simultaneously.

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
        return creatorId !== currentUserId; // I'm not the owner → it's assigned to me
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
        let sortedTasks: Task[] = [];
        if (taskFilters.size === 0) {
            sortedTasks = todaysTasks;
        } else {
            // Intersection: task must pass EVERY active filter predicate
            const activePredicates = Array.from(taskFilters)
                .map(f => filterPredicates[f])
                .filter(Boolean);
            sortedTasks = todaysTasks.filter(t => {
                return activePredicates.every(pred => pred(t));
            });
        }

        let sortedTodos: Task[] = [];
        if (todoFilters.size === 0) {
            sortedTodos = todaysTodos;
        } else {
            // For todos, only overdue filter exists currently
            sortedTodos = todaysTodos.filter(t => {
                if (todoFilters.has('overdue')) {
                    return isOverdueTask(t);
                }
                return false;
            });
        }

        return { displayTasks: sortedTasks, displayTodos: sortedTodos };
    }, [taskFilters, todoFilters, todaysTasks, todaysTodos, allTasks, filterPredicates, isOverdueTask]);



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

    /* ── Glassmorphism token ── */
    const glass = "backdrop-blur-xl bg-white/60 border border-white/40 shadow-sm";

    return (
        <div className="max-w-3xl animate-fade-in-up pb-56">

            {/* Dashboard Title & Month Label */}
            <div className="flex items-center justify-between mb-6 pl-1 pr-2 sm:pl-2 sm:pr-3">
                <div className="flex items-center gap-2.5">
                    <CalendarDays className="w-5 h-5 sm:w-6 sm:h-6 text-orange-500" />
                    <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 tracking-tight">
                        Next 7 Days
                    </h1>
                </div>
                <span className="text-sm font-bold text-gray-900 tracking-tight">
                    {format(selectedDate, "MMMM yyyy")}
                </span>
            </div>

            {/* Section 1: Weekly Calendar Strip */}
            <div className="mb-6">
                <WeeklyCalendarStrip
                    tasks={allTasks}
                    selectedDate={selectedDate}
                    onSelectDate={(d) => {
                        setSelectedDate(d);
                    }}
                />
            </div>

            {/* Tasks / Todos Glassmorphism Tab Toggle ── */}
            <div className={cn("rounded-2xl p-1 mb-4", glass)}>
                <div className="flex">
                    <button
                        onClick={() => setMainTab("tasks")}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-bold transition-all duration-200",
                            mainTab === "tasks"
                                ? "bg-gray-900 text-white shadow-md"
                                : "text-gray-700/80 hover:text-gray-900"
                        )}
                    >
                        Tasks
                        {todaysTasks.length > 0 && (
                            <span className={cn(
                                "px-1.5 py-0.5 text-[10px] font-black rounded-full min-w-[20px] text-center",
                                mainTab === "tasks" ? "bg-white text-gray-900" : "bg-gray-900/20 text-gray-900/70"
                            )}>
                                {todaysTasks.length}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => setMainTab("todos")}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-bold transition-all duration-200",
                            mainTab === "todos"
                                ? "bg-gray-900 text-white shadow-md"
                                : "text-gray-700/80 hover:text-gray-900"
                        )}
                    >
                        To-dos
                        {todaysTodos.length > 0 && (
                            <span className={cn(
                                "px-1.5 py-0.5 text-[10px] font-black rounded-full min-w-[20px] text-center",
                                mainTab === "todos" ? "bg-white text-gray-900" : "bg-gray-900/20 text-gray-900/70"
                            )}>
                                {todaysTodos.length}
                            </span>
                        )}
                    </button>
                </div>
            </div>

            {/* ── Glassmorphism Content Area ── */}
            <div className="min-h-[400px]">
                {mainTab === "tasks" && (
                    <div className="animate-fade-in-up space-y-4" style={{ animationDuration: '0.3s' }}>
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
                                <div className="px-6 py-14 mt-2 text-center bg-white/50 rounded-2xl border border-dashed border-white/60">
                                    <p className="text-sm text-gray-600 font-semibold">
                                        {taskFilters.size > 0
                                            ? "No tasks match the selected filters."
                                            : `No tasks for ${isTodaySelected ? 'today' : format(selectedDate, 'MMM d')}.`}
                                    </p>
                                </div>
                            ) : (
                                displayTasks.map(t => {
                                    return (
                                        <TaskCard
                                            key={t.id}
                                            task={t}
                                            category={getTaskColorCategory(t, currentUserId)}
                                            currentUserId={currentUserId}
                                            tags={getTaskTags(t, currentUserId)}
                                        />
                                    );
                                })
                            )}
                        </div>
                    </div>
                )}

                {mainTab === "todos" && (
                    <div className="animate-fade-in-up space-y-4" style={{ animationDuration: '0.3s' }}>
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
                                <div className="px-6 py-14 mt-2 text-center bg-white/50 rounded-2xl border border-dashed border-white/60">
                                    <p className="text-sm text-gray-600 font-semibold">
                                        {todoFilters.size > 0
                                            ? "No to-dos match the selected filters."
                                            : `No to-dos for ${isTodaySelected ? 'today' : format(selectedDate, 'MMM d')}.`}
                                    </p>
                                </div>
                            ) : (
                                displayTodos.map(t => {
                                    return (
                                        <TaskCard
                                            key={t.id}
                                            task={t}
                                            category={getTaskColorCategory(t, currentUserId)}
                                            currentUserId={currentUserId}
                                            tags={getTaskTags(t, currentUserId)}
                                        />
                                    );
                                })
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
