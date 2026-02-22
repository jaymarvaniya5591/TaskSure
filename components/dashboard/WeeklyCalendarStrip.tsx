"use client";

/**
 * Section 1 — Weekly Calendar Strip
 * Mon–Sun of the current week. Today is highlighted boldly.
 * Now merged with WeeklyOverview: Interactive, shows task counts, and allows date selection.
 */

import { format, addDays, startOfDay, endOfDay, isToday as checkIsToday, isSameDay } from "date-fns";
import { cn } from "@/lib/utils";
import { type Task } from "@/lib/types";
import { CalendarDays } from "lucide-react";

interface CalendarStripProps {
    tasks: Task[];
    selectedDate: Date;
    onSelectDate: (date: Date) => void;
}

export default function WeeklyCalendarStrip({ tasks, selectedDate, onSelectDate }: CalendarStripProps) {
    const today = new Date();
    // Default to the next 7 days starting from today
    const start = startOfDay(today);

    const days = Array.from({ length: 7 }).map((_, i) => {
        const date = addDays(start, i);
        const dayStart = startOfDay(date);
        const dayEnd = endOfDay(date);

        const isDateToday = checkIsToday(date);
        const dayTasks = tasks.filter(t => {
            const dl = t.committed_deadline || t.deadline;
            if (!dl) return false;
            const d = new Date(dl);
            // Today: include overdue tasks (deadline ≤ end of today)
            if (isDateToday) {
                return d <= dayEnd;
            }
            return d >= dayStart && d <= dayEnd;
        });

        let todosCount = 0;
        let tasksCount = 0;

        dayTasks.forEach(t => {
            const cId = typeof t.created_by === 'object' && t.created_by !== null && "id" in t.created_by ? (t.created_by as unknown as Record<string, unknown>).id : t.created_by;
            const aId = typeof t.assigned_to === 'object' && t.assigned_to !== null && "id" in t.assigned_to ? (t.assigned_to as unknown as Record<string, unknown>).id : t.assigned_to;

            if (cId === aId) todosCount++;
            else tasksCount++;
        });

        return {
            date,
            todosCount,
            tasksCount,
            isToday: checkIsToday(date),
            isSelected: isSameDay(date, selectedDate)
        };
    });

    return (
        <section className="backdrop-blur-xl bg-white/60 border border-white/40 shadow-sm rounded-2xl p-1 mb-6 relative overflow-hidden animate-fade-in-up">
            <div className="relative z-10">
                <div className="flex items-center justify-between px-2 pt-2 pb-2 sm:px-3 sm:pt-3 sm:pb-3">
                    <div className="flex items-center gap-2 ml-1">
                        <CalendarDays className="w-4 h-4 text-orange-500" />
                        <h2 className="text-sm font-bold text-gray-900 tracking-tight">Next 7 Days</h2>
                    </div>
                    <span className="text-sm font-bold text-gray-900 tracking-tight">
                        {format(start, "MMMM yyyy")}
                    </span>
                </div>

                <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                    {days.map((day, i) => {
                        const hasItems = day.todosCount + day.tasksCount > 0;

                        return (
                            <button
                                key={i}
                                onClick={() => onSelectDate(day.date)}
                                className={cn(
                                    "flex flex-col items-center px-1 py-1.5 sm:px-2 sm:py-2 rounded-xl transition-all duration-300 border text-left outline-none",
                                    day.isSelected
                                        ? "bg-white text-gray-900 border-gray-200 shadow-md scale-105"
                                        : day.isToday
                                            ? "bg-white/80 border-orange-400 hover:bg-white"
                                            : "bg-white/40 border-white/40 hover:bg-white/60 text-gray-600 hover:border-white/60"
                                )}
                            >
                                <span className={cn(
                                    "text-[10px] sm:text-xs font-bold uppercase tracking-wider mb-1",
                                    day.isSelected ? "text-gray-500" : day.isToday ? "text-orange-600" : "text-gray-500"
                                )}>
                                    {format(day.date, "EEE")}
                                </span>
                                <span className={cn(
                                    "text-lg sm:text-xl font-black mb-1.5 sm:mb-2",
                                    day.isSelected ? "text-gray-900" : day.isToday ? "text-gray-900" : "text-gray-700"
                                )}>
                                    {format(day.date, "d")}
                                </span>

                                {/* Count Pills */}
                                {hasItems ? (
                                    <div className="flex flex-wrap justify-center gap-1 sm:gap-1.5 w-full">
                                        {day.todosCount > 0 && (
                                            <span
                                                title={`${day.todosCount} To-dos`}
                                                className={cn(
                                                    "w-4 h-4 sm:w-5 sm:h-5 rounded-md text-[9px] sm:text-[10px] font-bold flex items-center justify-center transition-colors",
                                                    day.isSelected ? "bg-violet-100 text-violet-700" : "bg-violet-50/60 text-violet-600 border border-violet-200/60"
                                                )}>{day.todosCount}</span>
                                        )}
                                        {day.tasksCount > 0 && (
                                            <span
                                                title={`${day.tasksCount} Tasks`}
                                                className={cn(
                                                    "w-4 h-4 sm:w-5 sm:h-5 rounded-md text-[9px] sm:text-[10px] font-bold flex items-center justify-center transition-colors",
                                                    day.isSelected ? "bg-amber-100 text-amber-700" : "bg-amber-50/60 text-amber-600 border border-amber-200/60"
                                                )}>{day.tasksCount}</span>
                                        )}
                                    </div>
                                ) : (
                                    <span className={cn("text-[10px] font-medium mt-1 select-none", day.isSelected ? "text-gray-400" : "text-gray-400")}>
                                        —
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
