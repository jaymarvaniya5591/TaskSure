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

            {/* Immersive Wrapper Block */}
            <div className="bg-[#FFCE34] rounded-[36px] p-2 sm:p-3 mb-8 shadow-sm animate-fade-in-up border-b-4 border-r-4 border-[#E2B11B]">

                {/* Envelope Toggles */}
                <div className="flex px-2 mb-3 mt-1 gap-2">
                    <button
                        onClick={() => setMainTab("tasks")}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-3xl text-sm sm:text-base font-bold transition-all duration-300",
                            mainTab === "tasks"
                                ? "bg-[#FFE070] text-[#1D2125] shadow-[inset_0_1px_2px_rgba(255,255,255,0.6)] border border-[#FFEA91]"
                                : "text-amber-950/60 hover:text-amber-950"
                        )}
                    >
                        Tasks
                    </button>
                    <button
                        onClick={() => setMainTab("todos")}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-3xl text-sm sm:text-base font-bold transition-all duration-300",
                            mainTab === "todos"
                                ? "bg-[#FFE070] text-[#1D2125] shadow-[inset_0_1px_2px_rgba(255,255,255,0.6)] border border-[#FFEA91]"
                                : "text-[#7B631C] hover:text-[#52410F]"
                        )}
                    >
                        To-dos
                    </button>
                </div>

                {/* Filter Area & List */}
                <div className="bg-[#FFE27B]/60 backdrop-blur-xl rounded-[32px] p-4 sm:p-6 shadow-[inset_0_1px_4px_rgba(255,255,255,0.6)] border border-[#FFE795] min-h-[400px]">
                    {mainTab === "tasks" && (
                        <div className="animate-fade-in-up space-y-6" style={{ animationDuration: '0.3s' }}>
                            {/* Task Filters */}
                            <div className="flex flex-wrap gap-2 items-center">
                                <button
                                    onClick={() => toggleFilter('action', true)}
                                    className={cn(
                                        "px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 transition-all duration-200 border",
                                        taskFilters.has('action')
                                            ? "bg-red-50 text-red-700 border-red-200 shadow-[inset_0_1px_2px_rgba(255,255,255,0.6)]"
                                            : "bg-[#FFF2B2]/50 text-[#52410F] border-[#FFF8DD]/40 hover:bg-[#FFF2B2]/70 shadow-sm"
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
                                            ? "bg-blue-50 text-blue-700 border-blue-200 shadow-[inset_0_1px_2px_rgba(255,255,255,0.6)]"
                                            : "bg-[#FFF2B2]/50 text-[#52410F] border-[#FFF8DD]/40 hover:bg-[#FFF2B2]/70 shadow-sm"
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
                                            ? "bg-orange-50 text-orange-700 border-orange-200 shadow-[inset_0_1px_2px_rgba(255,255,255,0.6)]"
                                            : "bg-[#FFF2B2]/50 text-[#52410F] border-[#FFF8DD]/40 hover:bg-[#FFF2B2]/70 shadow-sm"
                                    )}
                                >
                                    <AlertCircle className="w-3.5 h-3.5" />
                                    Overdue
                                </button>

                                {taskFilters.size > 0 && (
                                    <button
                                        onClick={() => setTaskFilters(new Set())}
                                        className="px-2.5 py-1.5 rounded-full text-xs font-bold text-[#7B631C] hover:text-[#52410F] hover:bg-[#FFE27B]/30 flex items-center gap-1 transition-all"
                                    >
                                        <X className="w-3 h-3" />
                                        Clear
                                    </button>
                                )}
                            </div>

                            {/* Task List */}
                            <div className="space-y-4">
                                {displayTasks.length === 0 ? (
                                    <div className="px-10 py-16 mt-6 text-center bg-[#FFE898]/50 backdrop-blur-md rounded-2xl border border-[#FFF6CF]/40 shadow-[inset_0_1px_3px_rgba(255,255,255,0.3)]">
                                        <p className="text-sm text-[#52410F] font-bold tracking-wide">
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
                        <div className="animate-fade-in-up space-y-6" style={{ animationDuration: '0.3s' }}>
                            {/* Todo Filters */}
                            <div className="flex flex-wrap gap-2 items-center">
                                <button
                                    onClick={() => toggleFilter('overdue', false)}
                                    className={cn(
                                        "px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 transition-all duration-200 border",
                                        todoFilters.has('overdue')
                                            ? "bg-red-50 text-red-700 border-red-200 shadow-[inset_0_1px_2px_rgba(255,255,255,0.6)]"
                                            : "bg-[#FFF2B2]/50 text-[#52410F] border-[#FFF8DD]/40 hover:bg-[#FFF2B2]/70 shadow-sm"
                                    )}
                                >
                                    <AlertCircle className="w-3.5 h-3.5" />
                                    Overdue
                                </button>

                                {todoFilters.size > 0 && (
                                    <button
                                        onClick={() => setTodoFilters(new Set())}
                                        className="px-2.5 py-1.5 rounded-full text-xs font-bold text-[#7B631C] hover:text-[#52410F] hover:bg-[#FFE27B]/30 flex items-center gap-1 transition-all"
                                    >
                                        <X className="w-3 h-3" />
                                        Clear
                                    </button>
                                )}
                            </div>

                            {/* Todo List */}
                            <div className="space-y-4">
                                {displayTodos.length === 0 ? (
                                    <div className="px-10 py-16 mt-6 text-center bg-[#FFE898]/50 backdrop-blur-md rounded-2xl border border-[#FFF6CF]/40 shadow-[inset_0_1px_3px_rgba(255,255,255,0.3)]">
                                        <p className="text-sm text-[#52410F] font-bold tracking-wide">
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
