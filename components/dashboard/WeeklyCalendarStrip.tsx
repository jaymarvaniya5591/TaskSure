"use client";

/**
 * Section 1 — Weekly Calendar Strip
 * Mon–Sun of the current week. Today is highlighted boldly.
 * Now merged with WeeklyOverview: Interactive, shows task counts, and allows date selection.
 */

import { format, addDays, startOfDay, endOfDay, isToday as checkIsToday, isSameDay } from "date-fns";
import { cn } from "@/lib/utils";
import { getTaskColorCategory } from "@/lib/colors";
import { type Task } from "@/lib/types";
import { CalendarDays } from "lucide-react";

interface CalendarStripProps {
    tasks: Task[];
    currentUserId: string;
    selectedDate: Date;
    onSelectDate: (date: Date) => void;
}

export default function WeeklyCalendarStrip({ tasks, currentUserId, selectedDate, onSelectDate }: CalendarStripProps) {
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
            const cat = getTaskColorCategory(t, currentUserId);
            if (cat === 'todo') todosCount++;
            else tasksCount++; // both owned and assigned and overdue
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
        <section className="bg-gray-900 rounded-3xl p-5 sm:p-6 mb-8 shadow-xl relative overflow-hidden animate-fade-in-up">
            {/* Background decoration */}
            <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-gray-800 rounded-full blur-3xl opacity-50 pointer-events-none" />

            <div className="relative z-10">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2">
                        <div className="p-2 rounded-xl bg-gray-800 border border-gray-700">
                            <CalendarDays className="w-4 h-4 text-orange-400" />
                        </div>
                        <h2 className="text-lg font-bold text-white tracking-tight">Next 7 Days</h2>
                    </div>
                    <span className="text-sm font-semibold text-gray-400 bg-gray-800/50 px-3 py-1 rounded-full border border-gray-700/50">
                        {format(start, "MMMM yyyy")}
                    </span>
                </div>

                <div className="grid grid-cols-7 gap-2 sm:gap-3">
                    {days.map((day, i) => {
                        const hasItems = day.todosCount + day.tasksCount > 0;

                        return (
                            <button
                                key={i}
                                onClick={() => onSelectDate(day.date)}
                                className={cn(
                                    "flex flex-col items-center px-1.5 py-2 sm:px-2.5 sm:py-2.5 rounded-xl transition-all duration-300 border text-left",
                                    day.isSelected
                                        ? "bg-white text-gray-900 border-white shadow-[0_0_20px_rgba(255,255,255,0.15)] scale-105"
                                        : day.isToday
                                            ? "bg-gray-800/80 border-orange-500/50 hover:bg-gray-800"
                                            : "bg-gray-800/40 border-gray-700/50 hover:bg-gray-800 hover:border-gray-600"
                                )}
                            >
                                <span className={cn(
                                    "text-[10px] sm:text-xs font-bold uppercase tracking-wider mb-1",
                                    day.isSelected ? "text-gray-500" : day.isToday ? "text-orange-400" : "text-gray-400"
                                )}>
                                    {format(day.date, "EEE")}
                                </span>
                                <span className={cn(
                                    "text-lg sm:text-xl font-black mb-1.5 sm:mb-2",
                                    day.isSelected ? "text-gray-900" : day.isToday ? "text-white" : "text-gray-300"
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
                                                    day.isSelected ? "bg-violet-100 text-violet-700" : "bg-violet-500/25 text-violet-300 border border-violet-400/40"
                                                )}>{day.todosCount}</span>
                                        )}
                                        {day.tasksCount > 0 && (
                                            <span
                                                title={`${day.tasksCount} Tasks`}
                                                className={cn(
                                                    "w-4 h-4 sm:w-5 sm:h-5 rounded-md text-[9px] sm:text-[10px] font-bold flex items-center justify-center transition-colors",
                                                    day.isSelected ? "bg-amber-100 text-amber-700" : "bg-amber-500/25 text-amber-300 border border-amber-400/40"
                                                )}>{day.tasksCount}</span>
                                        )}
                                    </div>
                                ) : (
                                    <span className={cn("text-[10px] font-medium mt-1 select-none", day.isSelected ? "text-gray-300" : "text-gray-700")}>
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
