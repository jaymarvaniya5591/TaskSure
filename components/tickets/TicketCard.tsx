"use client";

import { memo } from "react";
import { format } from "date-fns";
import { Clock, User, Pencil, CheckCircle2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Ticket, TicketStatus } from "@/lib/types";
import { isTicketOverdue } from "@/lib/ticket-service";

const STATUS_STYLES: Record<TicketStatus | 'overdue_visual', { bar: string; badge: string; label: string }> = {
    pending: {
        bar: "bg-amber-400",
        badge: "bg-amber-100 text-amber-700 border-amber-200",
        label: "Pending",
    },
    accepted: {
        bar: "bg-ticket-500",
        badge: "bg-blue-100 text-blue-700 border-blue-200",
        label: "Accepted",
    },
    completed: {
        bar: "bg-gray-300",
        badge: "bg-emerald-50 text-emerald-600 border-emerald-200",
        label: "Completed",
    },
    rejected: {
        bar: "bg-red-400",
        badge: "bg-red-100 text-red-600 border-red-200",
        label: "Rejected",
    },
    cancelled: {
        bar: "bg-gray-300",
        badge: "bg-gray-100 text-gray-500 border-gray-200",
        label: "Cancelled",
    },
    overdue: {
        bar: "bg-overdue-500",
        badge: "bg-rose-100 text-rose-700 border-rose-200",
        label: "Overdue",
    },
    overdue_visual: {
        bar: "bg-overdue-500",
        badge: "bg-rose-100 text-rose-700 border-rose-200",
        label: "Overdue",
    },
};

interface TicketCardProps {
    ticket: Ticket;
    onEdit: (ticket: Ticket) => void;
    onComplete: (ticket: Ticket) => void;
    onDelete: (ticket: Ticket) => void;
}

export const TicketCard = memo(function TicketCard({ ticket, onEdit, onComplete, onDelete }: TicketCardProps) {
    const overdue = isTicketOverdue(ticket);
    const statusKey = overdue ? 'overdue_visual' : ticket.status;
    const status = STATUS_STYLES[statusKey] || STATUS_STYLES.pending;
    const vendorName = ticket.vendor?.name || ticket.vendor?.phone_number || "Unknown";
    const canComplete = ['pending', 'accepted'].includes(ticket.status);
    const canEdit = !['completed', 'cancelled', 'rejected'].includes(ticket.status);

    return (
        <div className="group relative rounded-2xl border border-gray-100 bg-white p-3 sm:p-4 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
            {/* Left accent bar */}
            <div className={cn("absolute left-0 top-3 bottom-3 w-1 rounded-full", status.bar)} />

            <div className="pl-3 flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                    {/* Subject */}
                    <h3 className="font-semibold text-sm sm:text-[15px] text-gray-900 line-clamp-2">
                        {ticket.subject}
                    </h3>

                    {/* Metadata row */}
                    <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-1.5 text-xs text-gray-500">
                        {ticket.deadline && (
                            <span className={cn("flex items-center gap-1", overdue && "text-rose-600 font-semibold")}>
                                <Clock className="w-3 h-3" />
                                {format(new Date(ticket.deadline), "MMM d, yyyy")}
                            </span>
                        )}
                        <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {vendorName}
                        </span>
                    </div>
                </div>

                {/* Right: status badge + actions */}
                <div className="flex items-center gap-2 shrink-0">
                    <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wide", status.badge)}>
                        {status.label}
                    </span>

                    {/* Actions */}
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {canEdit && (
                            <button
                                onClick={() => onEdit(ticket)}
                                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                                title="Edit ticket"
                            >
                                <Pencil className="w-3.5 h-3.5" />
                            </button>
                        )}
                        {canComplete && (
                            <button
                                onClick={() => onComplete(ticket)}
                                className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                                title="Mark completed"
                            >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                            </button>
                        )}
                        {canEdit && (
                            <button
                                onClick={() => onDelete(ticket)}
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Cancel ticket"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
});

export function TicketCardSkeleton() {
    return (
        <div className="rounded-2xl border border-gray-100 bg-white p-3 sm:p-4 animate-pulse">
            <div className="flex items-start gap-3">
                <div className="w-1 h-12 rounded-full bg-gray-200" />
                <div className="flex-1">
                    <div className="h-4 bg-gray-200/70 rounded-xl w-48 mb-2" />
                    <div className="flex gap-3">
                        <div className="h-3 bg-gray-200/70 rounded-xl w-20" />
                        <div className="h-3 bg-gray-200/70 rounded-xl w-24" />
                    </div>
                </div>
                <div className="h-5 bg-gray-200/70 rounded-full w-16" />
            </div>
        </div>
    );
}
