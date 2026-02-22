"use client";

import { useState, useMemo } from "react";
import { format, isToday, startOfDay, endOfDay } from "date-fns";
import WeeklyCalendarStrip from "@/components/dashboard/WeeklyCalendarStrip";
import { type Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import TaskCard from "@/components/dashboard/TaskCard";
import { getTaskColorCategory } from "@/lib/colors";
import { X, AlertTriangle, Clock, AlertCircle } from "lucide-react";

interface DashboardClientProps {
    greeting: string;
    firstName: string;
    dateString: string;
    currentUserId: string;
    allTasks: Task[];
    actionRequired: Task[];
    waitingOnOthers: Task[];
    overdueTasks: Task[];
}

export default function DashboardClient({
    greeting,
    firstName,
    dateString,
    currentUserId,
    allTasks,
    actionRequired,
    waitingOnOthers,
    overdueTasks,
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
        if (!dl) return false;
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

    // Memoize the filtering logic
    const { displayTasks, displayTodos } = useMemo(() => {
        let sortedTasks: Task[] = [];
        if (taskFilters.size === 0) {
            sortedTasks = todaysTasks;
        } else {
            const tempMap = new Map<string, Task>();
            if (taskFilters.has('action')) {
                actionRequired.filter(t => !isTodo(t)).forEach(t => tempMap.set(t.id, t));
            }
            if (taskFilters.has('waiting')) {
                waitingOnOthers.filter(t => !isTodo(t)).forEach(t => tempMap.set(t.id, t));
            }
            if (taskFilters.has('overdue')) {
                overdueTasks.filter(t => !isTodo(t)).forEach(t => tempMap.set(t.id, t));
            }
            sortedTasks = Array.from(tempMap.values());
        }

        let sortedTodos: Task[] = [];
        if (todoFilters.size === 0) {
            sortedTodos = todaysTodos;
        } else {
            const tempMap = new Map<string, Task>();
            if (todoFilters.has('overdue')) {
                overdueTasks.filter(t => isTodo(t)).forEach(t => tempMap.set(t.id, t));
            }
            sortedTodos = Array.from(tempMap.values());
        }

        return { displayTasks: sortedTasks, displayTodos: sortedTodos };
    }, [taskFilters, todoFilters, todaysTasks, todaysTodos, actionRequired, waitingOnOthers, overdueTasks]);



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
        <div className="max-w-3xl animate-fade-in-up">
            {/* Greeting */}
            <div className="mb-6">
                <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight flex items-center gap-2">
                    {greeting}, <span className="bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">{firstName}</span>
                </h1>
                <p className="text-gray-500 mt-1 text-sm font-medium">{dateString}</p>
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

            {/* ═══ Main Block — Vibrant Yellow Notebook ═══ */}
            <div
                className="relative rounded-3xl p-3 sm:p-4 mb-8 animate-fade-in-up"
                style={{
                    background: "linear-gradient(135deg, #FFD600 0%, #FFAB00 50%, #FFC107 100%)",
                }}
            >
                {/* Dotted grid overlay for notebook texture */}
                <div
                    className="absolute inset-0 pointer-events-none opacity-[0.07]"
                    style={{
                        backgroundImage: "radial-gradient(circle, #000 1px, transparent 1px)",
                        backgroundSize: "20px 20px",
                    }}
                />

                {/* Subtle corner glow */}
                <div className="absolute -top-20 -right-20 w-40 h-40 bg-white rounded-full blur-3xl opacity-20 pointer-events-none" />
                <div className="absolute -bottom-16 -left-16 w-32 h-32 bg-orange-300 rounded-full blur-3xl opacity-20 pointer-events-none" />

                <div className="relative z-10 space-y-3 sm:space-y-4">

                    {/* ── Subblock 1: Glassmorphism Tab Toggle ── */}
                    <div className={cn("rounded-2xl p-1", glass)}>
                        <div className="flex">
                            <button
                                onClick={() => setMainTab("tasks")}
                                className={cn(
                                    "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-bold transition-all duration-200",
                                    mainTab === "tasks"
                                        ? "bg-white text-gray-900 shadow-md"
                                        : "text-gray-700/80 hover:text-gray-900"
                                )}
                            >
                                Tasks
                                {todaysTasks.length > 0 && (
                                    <span className={cn(
                                        "px-1.5 py-0.5 text-[10px] font-black rounded-full min-w-[20px] text-center",
                                        mainTab === "tasks" ? "bg-gray-900 text-white" : "bg-gray-900/20 text-gray-900/70"
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
                                        ? "bg-white text-gray-900 shadow-md"
                                        : "text-gray-700/80 hover:text-gray-900"
                                )}
                            >
                                To-dos
                                {todaysTodos.length > 0 && (
                                    <span className={cn(
                                        "px-1.5 py-0.5 text-[10px] font-black rounded-full min-w-[20px] text-center",
                                        mainTab === "todos" ? "bg-gray-900 text-white" : "bg-gray-900/20 text-gray-900/70"
                                    )}>
                                        {todaysTodos.length}
                                    </span>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* ── Subblock 3: Glassmorphism Content Area ── */}
                    <div className={cn("rounded-2xl p-3 sm:p-5 min-h-[400px]", glass)}>
                        {mainTab === "tasks" && (
                            <div className="animate-fade-in-up space-y-4" style={{ animationDuration: '0.3s' }}>
                                {/* Task Filters */}
                                <div className="flex flex-wrap gap-2 items-center">
                                    <button
                                        onClick={() => toggleFilter('action', true)}
                                        className={cn(
                                            "px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 transition-all duration-200 border backdrop-blur-sm",
                                            taskFilters.has('action')
                                                ? "bg-red-500/90 text-white border-red-400 shadow-md"
                                                : "bg-white/70 text-gray-700 border-white/50 hover:bg-white/90 shadow-sm"
                                        )}
                                    >
                                        <AlertTriangle className="w-3.5 h-3.5" />
                                        Action Required
                                    </button>
                                    <button
                                        onClick={() => toggleFilter('waiting', true)}
                                        className={cn(
                                            "px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 transition-all duration-200 border backdrop-blur-sm",
                                            taskFilters.has('waiting')
                                                ? "bg-blue-500/90 text-white border-blue-400 shadow-md"
                                                : "bg-white/70 text-gray-700 border-white/50 hover:bg-white/90 shadow-sm"
                                        )}
                                    >
                                        <Clock className="w-3.5 h-3.5" />
                                        Waiting on Others
                                    </button>
                                    <button
                                        onClick={() => toggleFilter('overdue', true)}
                                        className={cn(
                                            "px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 transition-all duration-200 border backdrop-blur-sm",
                                            taskFilters.has('overdue')
                                                ? "bg-orange-600/90 text-white border-orange-500 shadow-md"
                                                : "bg-white/70 text-gray-700 border-white/50 hover:bg-white/90 shadow-sm"
                                        )}
                                    >
                                        <AlertCircle className="w-3.5 h-3.5" />
                                        Overdue
                                    </button>

                                    {taskFilters.size > 0 && (
                                        <button
                                            onClick={() => setTaskFilters(new Set())}
                                            className="px-2.5 py-1.5 rounded-full text-xs font-bold text-gray-700/70 hover:text-gray-900 hover:bg-white/50 flex items-center gap-1 transition-all"
                                        >
                                            <X className="w-3 h-3" />
                                            Clear
                                        </button>
                                    )}
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
                                        displayTasks.map(t => (
                                            <TaskCard
                                                key={t.id}
                                                task={t}
                                                category={getTaskColorCategory(t, currentUserId)}
                                                currentUserId={currentUserId}
                                            />
                                        ))
                                    )}
                                </div>
                            </div>
                        )}

                        {mainTab === "todos" && (
                            <div className="animate-fade-in-up space-y-4" style={{ animationDuration: '0.3s' }}>
                                {/* Todo Filters */}
                                <div className="flex flex-wrap gap-2 items-center">
                                    <button
                                        onClick={() => toggleFilter('overdue', false)}
                                        className={cn(
                                            "px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 transition-all duration-200 border backdrop-blur-sm",
                                            todoFilters.has('overdue')
                                                ? "bg-red-500/90 text-white border-red-400 shadow-md"
                                                : "bg-white/70 text-gray-700 border-white/50 hover:bg-white/90 shadow-sm"
                                        )}
                                    >
                                        <AlertCircle className="w-3.5 h-3.5" />
                                        Overdue
                                    </button>

                                    {todoFilters.size > 0 && (
                                        <button
                                            onClick={() => setTodoFilters(new Set())}
                                            className="px-2.5 py-1.5 rounded-full text-xs font-bold text-gray-700/70 hover:text-gray-900 hover:bg-white/50 flex items-center gap-1 transition-all"
                                        >
                                            <X className="w-3 h-3" />
                                            Clear
                                        </button>
                                    )}
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
                                        displayTodos.map(t => (
                                            <TaskCard
                                                key={t.id}
                                                task={t}
                                                category={getTaskColorCategory(t, currentUserId)}
                                                currentUserId={currentUserId}
                                            />
                                        ))
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
