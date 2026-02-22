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

    // Filter tasks for the selected date
    const dayStart = startOfDay(selectedDate);
    const dayEnd = endOfDay(selectedDate);
    const selectedDayTasks = allTasks.filter(t => {
        const dl = t.committed_deadline || t.deadline;
        if (!dl) return false;
        const d = new Date(dl);
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

    const isTodaySelected = isToday(selectedDate);

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
                    currentUserId={currentUserId}
                    selectedDate={selectedDate}
                    onSelectDate={(d) => {
                        setSelectedDate(d);
                    }}
                />
            </div>

            {/* Clean White Card Wrapper */}
            <div className="bg-white rounded-3xl p-3 sm:p-4 mb-8 shadow-sm animate-fade-in-up border border-gray-200">

                {/* Tab Toggles — matching AllTasksClient pattern */}
                <div className="flex bg-gray-100 rounded-xl p-1 mb-4">
                    <button
                        onClick={() => setMainTab("tasks")}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all duration-200",
                            mainTab === "tasks"
                                ? "bg-white text-gray-900 shadow-sm"
                                : "text-gray-500 hover:text-gray-700"
                        )}
                    >
                        Tasks
                        {todaysTasks.length > 0 && (
                            <span className={cn(
                                "px-1.5 py-0.5 text-[10px] font-bold rounded-full",
                                mainTab === "tasks" ? "bg-gray-900 text-white" : "bg-gray-200 text-gray-600"
                            )}>
                                {todaysTasks.length}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => setMainTab("todos")}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all duration-200",
                            mainTab === "todos"
                                ? "bg-white text-gray-900 shadow-sm"
                                : "text-gray-500 hover:text-gray-700"
                        )}
                    >
                        To-dos
                        {todaysTodos.length > 0 && (
                            <span className={cn(
                                "px-1.5 py-0.5 text-[10px] font-bold rounded-full",
                                mainTab === "todos" ? "bg-gray-900 text-white" : "bg-gray-200 text-gray-600"
                            )}>
                                {todaysTodos.length}
                            </span>
                        )}
                    </button>
                </div>

                {/* Filter Area & List */}
                <div className="bg-gray-50/80 rounded-2xl p-3 sm:p-5 border border-gray-100 min-h-[400px]">
                    {mainTab === "tasks" && (
                        <div className="animate-fade-in-up space-y-5" style={{ animationDuration: '0.3s' }}>
                            {/* Task Filters */}
                            <div className="flex flex-wrap gap-2 items-center">
                                <button
                                    onClick={() => toggleFilter('action', true)}
                                    className={cn(
                                        "px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 transition-all duration-200 border",
                                        taskFilters.has('action')
                                            ? "bg-red-50 text-red-700 border-red-200 shadow-sm"
                                            : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50 shadow-sm"
                                    )}
                                >
                                    <AlertTriangle className="w-3.5 h-3.5" />
                                    Action Required
                                </button>
                                <button
                                    onClick={() => toggleFilter('waiting', true)}
                                    className={cn(
                                        "px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 transition-all duration-200 border",
                                        taskFilters.has('waiting')
                                            ? "bg-blue-50 text-blue-700 border-blue-200 shadow-sm"
                                            : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50 shadow-sm"
                                    )}
                                >
                                    <Clock className="w-3.5 h-3.5" />
                                    Waiting on Others
                                </button>
                                <button
                                    onClick={() => toggleFilter('overdue', true)}
                                    className={cn(
                                        "px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 transition-all duration-200 border",
                                        taskFilters.has('overdue')
                                            ? "bg-orange-50 text-orange-700 border-orange-200 shadow-sm"
                                            : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50 shadow-sm"
                                    )}
                                >
                                    <AlertCircle className="w-3.5 h-3.5" />
                                    Overdue
                                </button>

                                {taskFilters.size > 0 && (
                                    <button
                                        onClick={() => setTaskFilters(new Set())}
                                        className="px-2.5 py-1.5 rounded-full text-xs font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100 flex items-center gap-1 transition-all"
                                    >
                                        <X className="w-3 h-3" />
                                        Clear
                                    </button>
                                )}
                            </div>

                            {/* Task List */}
                            <div className="space-y-3">
                                {displayTasks.length === 0 ? (
                                    <div className="px-6 py-14 mt-4 text-center bg-white rounded-2xl border border-dashed border-gray-200">
                                        <p className="text-sm text-gray-500 font-medium">
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
                        <div className="animate-fade-in-up space-y-5" style={{ animationDuration: '0.3s' }}>
                            {/* Todo Filters */}
                            <div className="flex flex-wrap gap-2 items-center">
                                <button
                                    onClick={() => toggleFilter('overdue', false)}
                                    className={cn(
                                        "px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 transition-all duration-200 border",
                                        todoFilters.has('overdue')
                                            ? "bg-red-50 text-red-700 border-red-200 shadow-sm"
                                            : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50 shadow-sm"
                                    )}
                                >
                                    <AlertCircle className="w-3.5 h-3.5" />
                                    Overdue
                                </button>

                                {todoFilters.size > 0 && (
                                    <button
                                        onClick={() => setTodoFilters(new Set())}
                                        className="px-2.5 py-1.5 rounded-full text-xs font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100 flex items-center gap-1 transition-all"
                                    >
                                        <X className="w-3 h-3" />
                                        Clear
                                    </button>
                                )}
                            </div>

                            {/* Todo List */}
                            <div className="space-y-3">
                                {displayTodos.length === 0 ? (
                                    <div className="px-6 py-14 mt-4 text-center bg-white rounded-2xl border border-dashed border-gray-200">
                                        <p className="text-sm text-gray-500 font-medium">
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
    );
}
