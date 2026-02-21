"use client";

import { useState } from "react";
import { format, isToday, startOfDay, endOfDay } from "date-fns";
import WeeklyCalendarStrip from "@/components/dashboard/WeeklyCalendarStrip";
import PendingActions from "@/components/dashboard/PendingActions";
import { type Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import TaskCard from "@/components/dashboard/TaskCard";
import { getTaskColorCategory } from "@/lib/colors";

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

type TabType = 'list' | 'action' | 'waiting' | 'overdue';

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
    const [activeTab, setActiveTab] = useState<TabType>('list');

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
    const overdueRealTasks = overdueTasks.filter(t => !isTodo(t));
    const overdueTodos = overdueTasks.filter(t => isTodo(t));

    const isTodaySelected = isToday(selectedDate);
    const listTabName = isTodaySelected ? "Today's Tasks" : "List of tasks";

    const tabs: { id: TabType; label: string; count: number }[] = [
        { id: 'list', label: listTabName, count: selectedDayTasks.length },
        { id: 'action', label: 'Action Required', count: actionRequired.length },
        { id: 'waiting', label: 'Waiting on Others', count: waitingOnOthers.length },
        { id: 'overdue', label: 'Overdue', count: overdueTasks.length },
    ];

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
                        setActiveTab('list'); // Automatically switch to list view when date is clicked
                    }}
                />
            </div>

            {/* Section 3: 4 Horizontal Tabs */}
            <div className="grid grid-cols-2 lg:flex bg-gray-100 rounded-xl p-1 mb-6 gap-1">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={cn(
                            "flex-1 flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-2 py-2.5 px-2 sm:px-3 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-200 whitespace-nowrap",
                            activeTab === tab.id
                                ? "bg-white text-gray-900 shadow-sm"
                                : "text-gray-500 hover:text-gray-700"
                        )}
                    >
                        {tab.label}
                        {tab.count > 0 && (
                            <span className={cn(
                                "px-1.5 py-0.5 text-[10px] sm:text-[11px] font-bold rounded-full",
                                activeTab === tab.id
                                    ? tab.id === 'overdue' ? "bg-red-100 text-red-700" : "bg-gray-900 text-white"
                                    : "bg-gray-200 text-gray-600"
                            )}>
                                {tab.count}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div className="pb-20">
                {activeTab === 'list' && (
                    <div className="animate-fade-in-up space-y-6" style={{ animationDuration: '0.3s' }}>
                        {selectedDayTasks.length === 0 ? (
                            <div className="p-8 text-center bg-gray-50 rounded-2xl border border-gray-100">
                                <p className="text-sm text-gray-500 font-medium tracking-wide">
                                    No tasks for {isTodaySelected ? 'today' : format(selectedDate, 'MMM d')}.
                                </p>
                            </div>
                        ) : (
                            <TaskTodoToggleList tasks={todaysTasks} todos={todaysTodos} currentUserId={currentUserId} emptyMessage="No tasks or to-dos for today." />
                        )}
                    </div>
                )}

                {activeTab === 'action' && (
                    <div className="animate-fade-in-up" style={{ animationDuration: '0.3s' }}>
                        <PendingActions
                            actionRequired={actionRequired}
                            waitingOnOthers={[]}
                            currentUserId={currentUserId}
                            hideTitle
                            forceMode="action"
                        />
                    </div>
                )}

                {activeTab === 'waiting' && (
                    <div className="animate-fade-in-up" style={{ animationDuration: '0.3s' }}>
                        <PendingActions
                            actionRequired={[]}
                            waitingOnOthers={waitingOnOthers}
                            currentUserId={currentUserId}
                            hideTitle
                            forceMode="waiting"
                        />
                    </div>
                )}

                {activeTab === 'overdue' && (
                    <div className="animate-fade-in-up space-y-6" style={{ animationDuration: '0.3s' }}>
                        {overdueTasks.length === 0 ? (
                            <div className="p-8 text-center bg-gray-50 rounded-2xl border border-gray-100">
                                <p className="text-sm text-gray-500 font-medium tracking-wide">
                                    No overdue tasks
                                </p>
                            </div>
                        ) : (
                            <TaskTodoToggleList tasks={overdueRealTasks} todos={overdueTodos} currentUserId={currentUserId} emptyMessage="No overdue tasks or to-dos." />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function TaskTodoToggleList({ tasks, todos, currentUserId, emptyMessage }: { tasks: Task[], todos: Task[], currentUserId: string, emptyMessage: string }) {
    const [subTab, setSubTab] = useState<"tasks" | "todos">("tasks");

    if (tasks.length === 0 && todos.length === 0) {
        return (
            <div className="p-8 text-center bg-gray-50 rounded-2xl border border-gray-100">
                <p className="text-sm text-gray-500 font-medium tracking-wide">
                    {emptyMessage}
                </p>
            </div>
        );
    }

    const currentList = subTab === "tasks" ? tasks : todos;

    return (
        <div className="animate-fade-in-up space-y-4" style={{ animationDuration: '0.3s' }}>
            <div className="flex bg-gray-100 rounded-xl p-1 shadow-sm border border-gray-200/50 max-w-sm">
                <button
                    onClick={() => setSubTab("todos")}
                    className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-semibold transition-all duration-200",
                        subTab === "todos"
                            ? "bg-white text-gray-900 shadow-sm border border-gray-200"
                            : "text-gray-500 hover:text-gray-700 hover:bg-white/50"
                    )}
                >
                    To-dos
                    <span className={cn(
                        "px-1.5 py-0.5 text-[10px] font-bold rounded-full",
                        subTab === "todos" ? "bg-gray-900 text-white" : "bg-gray-200 text-gray-600"
                    )}>
                        {todos.length}
                    </span>
                </button>
                <button
                    onClick={() => setSubTab("tasks")}
                    className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-semibold transition-all duration-200",
                        subTab === "tasks"
                            ? "bg-white text-gray-900 shadow-sm border border-gray-200"
                            : "text-gray-500 hover:text-gray-700 hover:bg-white/50"
                    )}
                >
                    Tasks
                    <span className={cn(
                        "px-1.5 py-0.5 text-[10px] font-bold rounded-full",
                        subTab === "tasks" ? "bg-gray-900 text-white" : "bg-gray-200 text-gray-600"
                    )}>
                        {tasks.length}
                    </span>
                </button>
            </div>

            <div className="space-y-3">
                {currentList.length === 0 ? (
                    <div className="p-6 text-center bg-transparent rounded-2xl border border-dashed border-gray-200">
                        <p className="text-sm text-gray-500 font-medium tracking-wide">No {subTab} found.</p>
                    </div>
                ) : (
                    currentList.map(t => (
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
    );
}
