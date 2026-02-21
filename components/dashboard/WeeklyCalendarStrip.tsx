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

        const dayTasks = tasks.filter(t => {
            const dl = t.committed_deadline || t.deadline;
            if (!dl) return false;
            const d = new Date(dl);
            return d >= dayStart && d <= dayEnd;
        });

        let todos = 0;
        let assigned = 0;
        let overdue = 0;

        dayTasks.forEach(t => {
            const cat = getTaskColorCategory(t, currentUserId);
            if (cat === 'overdue') overdue++;
            else if (cat === 'todo') todos++;
            else assigned++; // both owned and assigned
        });

        return {
            date,
            todos,
            assigned,
            overdue,
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
                        const hasItems = day.todos + day.assigned + day.overdue > 0;

                        return (
                            <button
                                key={i}
                                onClick={() => onSelectDate(day.date)}
                                className={cn(
                                    "flex flex-col items-center p-2 sm:p-3 rounded-2xl transition-all duration-300 border text-left",
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
                                    "text-lg sm:text-2xl font-black mb-2 sm:mb-3",
                                    day.isSelected ? "text-gray-900" : day.isToday ? "text-white" : "text-gray-300"
                                )}>
                                    {format(day.date, "d")}
                                </span>

                                {/* Count Pills */}
                                {hasItems ? (
                                    <div className="flex flex-wrap justify-center gap-1 sm:gap-1.5 w-full">
                                        {day.todos > 0 && (
                                            <span className={cn(
                                                "w-4 h-4 sm:w-5 sm:h-5 rounded-md text-[9px] sm:text-[10px] font-bold flex items-center justify-center transition-colors",
                                                day.isSelected ? "bg-todo-100 text-todo-700" : "bg-todo-500/20 text-todo-400 border border-todo-500/30"
                                            )}>{day.todos}</span>
                                        )}
                                        {day.assigned > 0 && (
                                            <span className={cn(
                                                "w-4 h-4 sm:w-5 sm:h-5 rounded-md text-[9px] sm:text-[10px] font-bold flex items-center justify-center transition-colors",
                                                day.isSelected ? "bg-owned-100 text-owned-700" : "bg-owned-500/20 text-owned-400 border border-owned-500/30"
                                            )}>{day.assigned}</span>
                                        )}
                                        {day.overdue > 0 && (
                                            <span className={cn(
                                                "w-4 h-4 sm:w-5 sm:h-5 rounded-md text-[9px] sm:text-[10px] font-bold flex items-center justify-center transition-colors",
                                                day.isSelected ? "bg-overdue-100 text-overdue-700" : "bg-overdue-500/20 text-overdue-400 border border-overdue-500/30"
                                            )}>{day.overdue}</span>
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
