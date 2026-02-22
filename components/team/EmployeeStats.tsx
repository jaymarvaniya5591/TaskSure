"use client";

/**
 * EmployeeStats — Performance analytics card with Recharts Donut.
 */

import { useState, useMemo, useRef, useEffect } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { ChevronDown, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Task } from "@/lib/types";

interface EmployeeStatsProps {
    allTasks: Task[]; // all tasks where this employee is assigned_to
}

export default function EmployeeStats({ allTasks }: EmployeeStatsProps) {
    const [dateFilter, setDateFilter] = useState<"7d" | "30d" | "all" | "custom">("7d");
    const [showDateDropdown, setShowDateDropdown] = useState(false);
    const [customStart, setCustomStart] = useState("");
    const [customEnd, setCustomEnd] = useState("");
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown on outside click
    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setShowDateDropdown(false);
            }
        }
        if (showDateDropdown) document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [showDateDropdown]);

    const filteredTasks = useMemo(() => {
        if (dateFilter === "all") return allTasks;

        const now = new Date();
        let startDate: Date | null = null;
        let endDate: Date | null = null;

        if (dateFilter === "7d") {
            startDate = new Date(now);
            startDate.setDate(startDate.getDate() - 7);
        } else if (dateFilter === "30d") {
            startDate = new Date(now);
            startDate.setDate(startDate.getDate() - 30);
        } else if (dateFilter === "custom" && customStart && customEnd) {
            startDate = new Date(customStart);
            endDate = new Date(customEnd);
            endDate.setHours(23, 59, 59, 999); // Include entire end day
        }

        if (!startDate) return allTasks; // Fallback if custom dates not set

        return allTasks.filter(t => {
            const created = new Date(t.created_at);
            const updated = t.updated_at ? new Date(t.updated_at) : created;
            const deadline = t.committed_deadline ? new Date(t.committed_deadline) : t.deadline ? new Date(t.deadline) : created;

            const isAfterStart = created >= startDate || updated >= startDate || deadline >= startDate;
            const isBeforeEnd = endDate ? (created <= endDate || updated <= endDate || deadline <= endDate) : true;

            return isAfterStart && isBeforeEnd;
        });
    }, [allTasks, dateFilter, customStart, customEnd]);

    const { active, completed, overdue, total } = useMemo(() => {
        let completedCount = 0;
        let activeCount = 0;
        let overdueCount = 0;

        filteredTasks.forEach(t => {
            if (t.status === "completed") {
                completedCount++;
            } else {
                const effectiveDeadline = t.committed_deadline || t.deadline;
                if (t.status === "overdue" || (effectiveDeadline && new Date(effectiveDeadline) < new Date())) {
                    overdueCount++;
                } else {
                    activeCount++;
                }
            }
        });

        return {
            active: activeCount,
            completed: completedCount,
            overdue: overdueCount,
            total: filteredTasks.length
        };
    }, [filteredTasks]);

    const chartData = [
        { name: "Active", value: active, color: "#3b82f6" },     // blue-500
        { name: "Completed", value: completed, color: "#14b8a6" }, // teal-500
        { name: "Overdue", value: overdue, color: "#f43f5e" },     // rose-500
    ].filter(d => d.value > 0);

    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 animate-fade-in-up">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400">
                    Performance Breakdown
                </h3>

                <div className="relative" ref={dropdownRef}>
                    <button
                        onClick={() => setShowDateDropdown(!showDateDropdown)}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-semibold text-gray-700 transition-colors shadow-sm"
                    >
                        <Calendar className="w-4 h-4 text-gray-400" />
                        {dateFilter === "7d" ? "Past 7 Days" :
                            dateFilter === "30d" ? "Past 30 Days" :
                                dateFilter === "all" ? "All Time" : "Custom Range"}
                        <ChevronDown className="w-4 h-4 text-gray-400 ml-1" />
                    </button>

                    {showDateDropdown && (
                        <div className="absolute left-0 sm:right-0 sm:left-auto top-full mt-2 w-64 bg-white rounded-2xl shadow-xl border border-gray-100 p-2 z-50 animate-fade-in-up origin-top-left sm:origin-top-right max-h-[60vh] overflow-y-auto">
                            <div className="flex flex-col gap-1">
                                {[
                                    { value: "7d", label: "Past 7 Days" },
                                    { value: "30d", label: "Past 30 Days" },
                                    { value: "all", label: "All Time" },
                                    { value: "custom", label: "Custom Range" }
                                ].map(opt => (
                                    <button
                                        key={opt.value}
                                        onClick={() => {
                                            setDateFilter(opt.value as "7d" | "30d" | "all" | "custom");
                                            if (opt.value !== "custom") setShowDateDropdown(false);
                                        }}
                                        className={cn(
                                            "w-full text-left px-3 py-2 rounded-xl text-sm font-semibold transition-colors",
                                            dateFilter === opt.value
                                                ? "bg-blue-50 text-blue-700"
                                                : "text-gray-600 hover:bg-gray-50"
                                        )}
                                    >
                                        {opt.label}
                                    </button>
                                ))}

                                {dateFilter === "custom" && (
                                    <div className="mt-3 pt-3 border-t border-gray-100 flex flex-col gap-3 px-1 pb-1">
                                        <div>
                                            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Start Date</label>
                                            <input
                                                type="date"
                                                value={customStart}
                                                onChange={e => setCustomStart(e.target.value)}
                                                className="w-full text-xs font-semibold px-2 py-1.5 rounded-lg border border-gray-200 outline-none focus:border-blue-500"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">End Date</label>
                                            <input
                                                type="date"
                                                value={customEnd}
                                                onChange={e => setCustomEnd(e.target.value)}
                                                className="w-full text-xs font-semibold px-2 py-1.5 rounded-lg border border-gray-200 outline-none focus:border-blue-500"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {total === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-gray-100 rounded-xl">
                    <p className="text-gray-400 font-semibold mb-1">No tasks to display</p>
                    <p className="text-xs text-gray-400">Try adjusting the date filter!</p>
                </div>
            ) : (
                <div className="flex flex-col lg:flex-row items-center gap-8">
                    {/* Donut Chart */}
                    <div className="w-full lg:w-1/2 h-64 relative">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={chartData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={70}
                                    outerRadius={90}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {chartData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                                    ))}
                                </Pie>
                                <Tooltip
                                    formatter={(value: string | number | undefined, name?: string) => [`${value} Task${value !== 1 ? 's' : ''}`, name || '']}
                                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', fontSize: '13px', fontWeight: 600 }}
                                    wrapperStyle={{ zIndex: 100 }}
                                />
                                <Legend verticalAlign="bottom" height={36} iconType="circle" />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none mb-8">
                            <span className="text-3xl font-black text-gray-900">{total}</span>
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Total</span>
                        </div>
                    </div>

                    {/* Quick Stats Sidebar */}
                    <div className="w-full lg:w-1/2 grid grid-cols-2 gap-3">
                        <div className="bg-teal-50 border border-teal-100 rounded-2xl p-4 flex flex-col justify-center">
                            <span className="text-teal-600 text-[10px] font-bold uppercase tracking-wider mb-1">Completed</span>
                            <span className="text-2xl font-black text-teal-700">{completed}</span>
                        </div>
                        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex flex-col justify-center">
                            <span className="text-blue-600 text-[10px] font-bold uppercase tracking-wider mb-1">Active</span>
                            <span className="text-2xl font-black text-blue-700">{active}</span>
                        </div>
                        <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 flex flex-col justify-center col-span-2">
                            <div className="flex justify-between items-center">
                                <div className="flex flex-col">
                                    <span className="text-rose-600 text-[10px] font-bold uppercase tracking-wider mb-1">Overdue</span>
                                    <span className="text-2xl font-black text-rose-700">{overdue}</span>
                                </div>
                                <div className="text-right">
                                    <span className="text-rose-500/80 text-xs font-semibold">Needs attention</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
