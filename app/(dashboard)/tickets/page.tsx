"use client";

import { useState, useMemo } from "react";
import { Ticket, Plus, Search, AlertTriangle } from "lucide-react";
import { useTickets, useCompleteTicket, useDeleteTicket } from "@/lib/hooks/useTickets";
import { TicketCard, TicketCardSkeleton } from "@/components/tickets/TicketCard";
import CreateTicketModal from "@/components/tickets/CreateTicketModal";
import EditTicketModal from "@/components/tickets/EditTicketModal";
import { isTicketOverdue } from "@/lib/ticket-service";
import { cn } from "@/lib/utils";
import type { Ticket as TicketType } from "@/lib/types";

export default function TicketsPage() {
    const { data, isLoading } = useTickets();
    const tickets = useMemo(() => data?.tickets || [], [data]);
    const completeTicket = useCompleteTicket();
    const deleteTicket = useDeleteTicket();

    const [searchQuery, setSearchQuery] = useState("");
    const [showOverdueOnly, setShowOverdueOnly] = useState(false);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [editingTicket, setEditingTicket] = useState<TicketType | null>(null);

    const filteredTickets = useMemo(() => {
        let result = tickets;

        // Overdue filter
        if (showOverdueOnly) {
            result = result.filter(t => isTicketOverdue(t));
        }

        // Search filter
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(t =>
                t.subject.toLowerCase().includes(q) ||
                t.vendor?.name?.toLowerCase().includes(q)
            );
        }

        return result;
    }, [tickets, searchQuery, showOverdueOnly]);

    const overdueCount = useMemo(() =>
        tickets.filter(t => isTicketOverdue(t)).length,
        [tickets]
    );

    const handleComplete = (ticket: TicketType) => {
        completeTicket.mutate(ticket.id);
    };

    const handleDelete = (ticket: TicketType) => {
        if (confirm("Are you sure you want to cancel this ticket?")) {
            deleteTicket.mutate(ticket.id);
        }
    };

    return (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">
                    Tickets
                </h1>
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-900 text-white text-sm font-bold rounded-xl hover:opacity-90 transition-all"
                >
                    <Plus className="w-4 h-4" />
                    Create Ticket
                </button>
            </div>

            {/* Search + Filters */}
            {tickets.length > 0 && (
                <div className="space-y-3 mb-5">
                    <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search tickets..."
                            className="w-full pl-10 pr-4 py-3 bg-gray-50/50 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 focus:bg-white transition-all text-sm placeholder:text-gray-400"
                        />
                    </div>

                    {/* Filter chips */}
                    <div className="flex gap-2 overflow-x-auto">
                        {overdueCount > 0 && (
                            <button
                                onClick={() => setShowOverdueOnly(!showOverdueOnly)}
                                className={cn(
                                    "px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 border backdrop-blur-sm transition-all whitespace-nowrap",
                                    showOverdueOnly
                                        ? "bg-rose-100 text-rose-700 border-rose-200 shadow-md"
                                        : "bg-white/70 text-gray-700 border-white/50 hover:bg-white/90"
                                )}
                            >
                                <AlertTriangle className="w-3 h-3" />
                                Overdue ({overdueCount})
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Loading */}
            {isLoading && (
                <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <TicketCardSkeleton key={i} />
                    ))}
                </div>
            )}

            {/* Empty state */}
            {!isLoading && tickets.length === 0 && (
                <div className="text-center py-16">
                    <Ticket className="mx-auto h-12 w-12 text-gray-300" />
                    <h3 className="text-sm font-semibold text-gray-900 mt-3">No tickets yet</h3>
                    <p className="text-sm text-gray-500 mt-1">
                        Create a ticket to track vendor obligations like shipments or payments.
                    </p>
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="mt-4 px-4 py-2 bg-gray-900 text-white text-sm font-bold rounded-xl hover:opacity-90 transition-all"
                    >
                        + Create Ticket
                    </button>
                </div>
            )}

            {/* No search results */}
            {!isLoading && tickets.length > 0 && filteredTickets.length === 0 && (
                <div className="text-center py-12">
                    <Search className="mx-auto h-8 w-8 text-gray-300" />
                    <p className="text-sm text-gray-500 mt-2">
                        No tickets match your search.
                    </p>
                </div>
            )}

            {/* Ticket list */}
            {!isLoading && filteredTickets.length > 0 && (
                <div className="space-y-3">
                    {filteredTickets.map(ticket => (
                        <TicketCard
                            key={ticket.id}
                            ticket={ticket}
                            onEdit={setEditingTicket}
                            onComplete={handleComplete}
                            onDelete={handleDelete}
                        />
                    ))}
                </div>
            )}

            {/* Modals */}
            <CreateTicketModal
                isOpen={showCreateModal}
                onClose={() => setShowCreateModal(false)}
            />
            <EditTicketModal
                isOpen={!!editingTicket}
                onClose={() => setEditingTicket(null)}
                ticket={editingTicket}
            />
        </div>
    );
}
