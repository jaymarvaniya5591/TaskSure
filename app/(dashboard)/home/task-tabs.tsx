"use client";

import { useState } from "react";
import { Clock, Calendar as CalendarIcon, CheckCircle2, AlertCircle, ArrowRightCircle } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

function StatusBadge({ status }: { status: string }) {
    const styles: Record<string, string> = {
        pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
        accepted: "bg-blue-100 text-blue-800 border-blue-200",
        overdue: "bg-red-100 text-red-800 border-red-200",
        completed: "bg-green-100 text-green-800 border-green-200",
    };
    const appliedStyle = styles[status] || "bg-gray-100 text-gray-800 border-gray-200";

    return (
        <span className={cn("px-2.5 py-0.5 rounded-full text-xs font-medium border capitalize", appliedStyle)}>
            {status}
        </span>
    );
}

function TaskCardEmpty({ message }: { message: string }) {
    return (
        <div className="p-8 text-center bg-gray-50 rounded-xl border border-dashed border-gray-200">
            <CheckCircle2 className="w-8 h-8 text-gray-400 mx-auto mb-3" />
            <p className="text-sm text-gray-500 font-medium">{message}</p>
        </div>
    );
}

type TaskProps = {
    todayTasks: any[];
    pendingTasks: any[];
    ownedPendingTasks: any[];
};

export default function TaskTabs({ todayTasks, pendingTasks, ownedPendingTasks }: TaskProps) {
    const [activeTab, setActiveTab] = useState<'today' | 'pending' | 'assigned'>('today');

    const tabs = [
        {
            id: 'today',
            label: "Today's Tasks",
            desc: "Due today",
            icon: CalendarIcon,
            count: todayTasks?.length || 0,
            bgActive: 'bg-gray-900 shadow-lg shadow-gray-900/20',
            textActive: 'text-white',
            textMutedActive: 'text-gray-400',
            iconBgActive: 'bg-white/10 text-white',
            badgeActive: 'bg-white text-gray-900',
            bgInactive: 'bg-white hover:bg-gray-50 border border-gray-100',
        },
        {
            id: 'pending',
            label: "Pending",
            desc: "Needs action",
            icon: AlertCircle,
            count: pendingTasks?.length || 0,
            bgActive: 'bg-accent-500 shadow-lg shadow-accent-500/30',
            textActive: 'text-gray-900',
            textMutedActive: 'text-gray-800 text-opacity-80',
            iconBgActive: 'bg-gray-900/10 text-gray-900',
            badgeActive: 'bg-gray-900 text-white',
            bgInactive: 'bg-white hover:bg-gray-50 border border-gray-100',
        },
        {
            id: 'assigned',
            label: "Assigned",
            desc: "By you",
            icon: ArrowRightCircle,
            count: ownedPendingTasks?.length || 0,
            bgActive: 'bg-blue-600 shadow-lg shadow-blue-600/20',
            textActive: 'text-white',
            textMutedActive: 'text-blue-100',
            iconBgActive: 'bg-white/10 text-white',
            badgeActive: 'bg-white text-blue-900',
            bgInactive: 'bg-white hover:bg-gray-50 border border-gray-100',
        }
    ];

    return (
        <div className="space-y-6">
            {/* Tabs Selector */}
            <div className="grid grid-cols-3 gap-3">
                {tabs.map((tab) => {
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={cn(
                                "flex flex-col items-start p-4 rounded-2xl transition-all duration-300 text-left relative overflow-hidden group focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent-500",
                                isActive ? tab.bgActive : tab.bgInactive
                            )}
                        >


                            <div className="flex items-center justify-between w-full mb-3 relative z-10">
                                <div className={cn(
                                    "p-2.5 rounded-xl transition-colors duration-300",
                                    isActive ? tab.iconBgActive : "bg-gray-50 text-gray-400 border border-gray-100 group-hover:bg-white group-hover:shadow-sm group-hover:text-gray-600"
                                )}>
                                    <tab.icon className="w-5 h-5" />
                                </div>
                                {tab.count > 0 && (
                                    <span className={cn(
                                        "px-2.5 py-0.5 text-xs font-bold rounded-full transition-colors duration-300",
                                        isActive ? tab.badgeActive : "bg-gray-100 text-gray-600 group-hover:bg-white border border-transparent group-hover:border-gray-200"
                                    )}>
                                        {tab.count}
                                    </span>
                                )}
                            </div>
                            <div className="relative z-10 block">
                                <h3 className={cn("font-bold text-[15px] transition-colors duration-300", isActive ? tab.textActive : "text-gray-900")}>
                                    {tab.label}
                                </h3>
                                <p className={cn("text-[11px] mt-0.5 font-medium transition-colors duration-300", isActive ? tab.textMutedActive : "text-gray-500")}>
                                    {tab.desc}
                                </p>
                            </div>
                        </button>
                    )
                })}
            </div>

            {/* Content Area */}
            <div className="relative min-h-[300px]">
                {/* Today's Tasks */}
                {activeTab === 'today' && (
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="p-4 sm:p-6 bg-gray-50/50">
                                {!todayTasks || todayTasks.length === 0 ? (
                                    <TaskCardEmpty message="No tasks due today 🎉" />
                                ) : (
                                    <ul className="space-y-3">
                                        {todayTasks.map(task => (
                                            <li key={task.id} className="flex items-center justify-between p-4 rounded-2xl border border-gray-100 hover:border-gray-200 hover:shadow-sm transition-all group bg-white shadow-sm">
                                                <div className="flex flex-col gap-1.5">
                                                    <p className="font-semibold text-gray-900 group-hover:text-accent-600 transition-colors">{task.title}</p>
                                                    <p className="text-xs text-gray-500 flex items-center gap-1.5">
                                                        <span className="font-medium text-gray-700">From: {task.created_by?.name || 'Unknown'}</span>
                                                        <span className="w-1 h-1 rounded-full bg-gray-300"></span>
                                                        <Clock className="w-3.5 h-3.5 text-gray-400" />
                                                        {format(new Date(task.deadline), 'h:mm a')}
                                                    </p>
                                                </div>
                                                <StatusBadge status={task.status} />
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Pending Acceptance */}
                {activeTab === 'pending' && (
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="p-4 sm:p-6 bg-yellow-50/20">
                                {!pendingTasks || pendingTasks.length === 0 ? (
                                    <TaskCardEmpty message="You've accepted all your tasks! 🙌" />
                                ) : (
                                    <ul className="space-y-3">
                                        {pendingTasks.map(task => (
                                            <li key={task.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-2xl border border-yellow-200 bg-yellow-50/40 gap-4 shadow-sm">
                                                <div className="flex flex-col gap-1.5">
                                                    <p className="font-semibold text-gray-900">{task.title}</p>
                                                    <p className="text-xs text-gray-600 flex items-center gap-1.5">
                                                        <span>Assigned by</span>
                                                        <span className="font-medium text-gray-900">{task.created_by?.name || 'Unknown'}</span>
                                                        <span className="w-1 h-1 rounded-full bg-gray-400"></span>
                                                        {format(new Date(task.created_at), 'MMM d, h:mm a')}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <button className="px-5 py-2.5 bg-white text-gray-700 text-sm font-semibold rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors shadow-sm">
                                                        REJECT
                                                    </button>
                                                    <button className="px-5 py-2.5 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-black transition-colors shadow-sm relative overflow-hidden group">
                                                        <span className="relative z-10">ACCEPT</span>
                                                        <div className="absolute inset-0 h-full w-full bg-white/20 scale-x-0 group-hover:scale-x-100 transition-transform origin-left rounded-xl duration-300"></div>
                                                    </button>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Tasks You Assigned */}
                {activeTab === 'assigned' && (
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="p-4 sm:p-6 bg-gray-50/50">
                                {!ownedPendingTasks || ownedPendingTasks.length === 0 ? (
                                    <TaskCardEmpty message="No pending tasks assigned by you! ✨" />
                                ) : (
                                    <ul className="space-y-3">
                                        {ownedPendingTasks.map(task => (
                                            <li key={task.id} className="flex items-center justify-between p-4 rounded-2xl border border-gray-200 bg-white shadow-sm hover:shadow transition-shadow">
                                                <div className="flex flex-col gap-1.5">
                                                    <p className="font-semibold text-gray-900 text-[15px]">{task.title}</p>
                                                    <p className="text-xs text-gray-500 flex items-center gap-1.5">
                                                        <span>Waiting on</span>
                                                        <span className="font-medium text-gray-800">{task.assigned_to?.name || 'Unknown'}</span>
                                                    </p>
                                                </div>
                                                <span className="text-xs font-medium text-gray-400 bg-gray-50 px-2 py-1 rounded-md border border-gray-100">
                                                    {format(new Date(task.created_at), 'MMM d, h:mm a')}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
