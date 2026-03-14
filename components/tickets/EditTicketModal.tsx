"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Pencil } from "lucide-react";
import { useEditTicket, useCompleteTicket, useDeleteTicket } from "@/lib/hooks/useTickets";
import { getTodayMidnightISO } from "@/lib/date-utils";
import DateTimePickerBoxes from "@/components/ui/DateTimePickerBoxes";
import { cn } from "@/lib/utils";
import type { Ticket } from "@/lib/types";

interface EditTicketModalProps {
    isOpen: boolean;
    onClose: () => void;
    ticket: Ticket | null;
}

const MODAL = {
    overlay: "fixed inset-0 z-[9999] flex items-end justify-center sm:items-center bg-gray-900/40 sm:p-4 backdrop-blur-sm transition-all duration-300",
    panel: "relative w-full sm:max-w-md bg-white rounded-t-[2rem] shadow-2xl sm:rounded-3xl flex flex-col max-h-[92vh] sm:max-h-[85vh] z-10 overflow-hidden",
    dragHandle: "sm:hidden w-full flex justify-center py-3 bg-white relative z-20",
    dragPill: "w-12 h-1.5 bg-gray-200 rounded-full",
    header: "flex items-center justify-between px-5 sm:px-6 pb-4 sm:pt-6 border-b border-gray-100 bg-white relative z-20 shrink-0",
    title: "text-xl sm:text-2xl font-extrabold tracking-tight text-gray-900",
    subtitle: "text-xs text-gray-500 mt-0.5",
    closeBtn: "p-2 sm:p-2.5 -mr-2 sm:-mr-1 bg-gray-50 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-all duration-200 flex-shrink-0",
    body: "p-5 sm:p-6 overflow-y-auto flex-1 bg-white overscroll-contain",
    footer: "p-5 sm:p-6 border-t border-gray-100 bg-white sm:bg-gray-50/50 mt-auto relative z-20 pb-8 sm:pb-6 shrink-0",
    label: "block mb-2 text-xs font-bold text-gray-500 uppercase tracking-wider",
    inputBase: "w-full px-4 py-3.5 sm:py-4 bg-gray-50/50 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 focus:bg-white transition-all text-sm sm:text-[15px] font-medium placeholder:font-normal placeholder:text-gray-400",
    btnCancel: "flex-1 px-4 py-3.5 sm:py-3 rounded-2xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors",
    errorBox: "mb-4 p-3.5 bg-red-50/80 text-red-700 rounded-2xl text-sm font-medium border border-red-100/50",
};

export default function EditTicketModal({ isOpen, onClose, ticket }: EditTicketModalProps) {
    const [mounted, setMounted] = useState(false);
    const [subject, setSubject] = useState("");
    const [deadline, setDeadline] = useState("");
    const [dateError, setDateError] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isCompleting, setIsCompleting] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const isSubmittingRef = useRef(false);

    const editTicket = useEditTicket();
    const completeTicket = useCompleteTicket();
    const deleteTicket = useDeleteTicket();

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (isOpen && ticket) {
            setSubject(ticket.subject);
            setDeadline(ticket.deadline || getTodayMidnightISO());
            setDateError(false);
            setError(null);
            setShowDeleteConfirm(false);
        }
    }, [isOpen, ticket]);

    const canComplete = ticket && ['pending', 'accepted'].includes(ticket.status);
    const canEdit = ticket && !['completed', 'cancelled', 'rejected'].includes(ticket.status);
    const vendorName = ticket?.vendor?.name || ticket?.vendor?.phone_number || "Unknown";

    const handleSave = async () => {
        if (isSubmittingRef.current || !ticket) return;
        setError(null);

        if (!subject.trim()) {
            setError("Subject is required");
            return;
        }
        if (subject.length > 200) {
            setError("Subject must be 200 characters or less");
            return;
        }
        if (dateError) {
            setError("Please fill out the full deadline correctly");
            return;
        }

        isSubmittingRef.current = true;
        setIsSubmitting(true);

        editTicket.mutate(
            { ticketId: ticket.id, subject: subject.trim(), deadline },
            {
                onSuccess: () => onClose(),
                onError: (err) => setError(err instanceof Error ? err.message : "Failed to update ticket"),
                onSettled: () => {
                    isSubmittingRef.current = false;
                    setIsSubmitting(false);
                },
            }
        );
    };

    const handleComplete = () => {
        if (!ticket) return;
        setError(null);
        setIsCompleting(true);

        completeTicket.mutate(ticket.id, {
            onSuccess: () => onClose(),
            onError: (err) => setError(err instanceof Error ? err.message : "Failed to complete ticket"),
            onSettled: () => setIsCompleting(false),
        });
    };

    const handleDelete = () => {
        if (!ticket) return;
        setError(null);
        setIsDeleting(true);

        deleteTicket.mutate(ticket.id, {
            onSuccess: () => onClose(),
            onError: (err) => {
                setError(err instanceof Error ? err.message : "Failed to cancel ticket");
                setShowDeleteConfirm(false);
            },
            onSettled: () => setIsDeleting(false),
        });
    };

    if (!mounted || !isOpen || !ticket) return null;

    const statusBadge = ticket.status === 'accepted'
        ? "bg-blue-100 text-blue-700 border-blue-200"
        : ticket.status === 'pending'
            ? "bg-amber-100 text-amber-700 border-amber-200"
            : ticket.status === 'completed'
                ? "bg-emerald-50 text-emerald-600 border-emerald-200"
                : "bg-gray-100 text-gray-500 border-gray-200";

    const modalContent = (
        <div className={MODAL.overlay}>
            <div className="absolute inset-0" onClick={onClose} />
            <div className={MODAL.panel}>
                <div className={MODAL.dragHandle}>
                    <div className={MODAL.dragPill} />
                </div>

                <div className={MODAL.header}>
                    <div>
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-gray-100">
                                <Pencil className="w-5 h-5 text-gray-900" />
                            </div>
                            <div>
                                <h3 className={MODAL.title}>Edit Ticket</h3>
                                <p className={MODAL.subtitle}>{vendorName}</p>
                            </div>
                        </div>
                    </div>
                    <button onClick={onClose} className={MODAL.closeBtn}>
                        <X className="w-5 h-5 cursor-pointer" />
                    </button>
                </div>

                <div className={MODAL.body}>
                    <div className="space-y-5">
                        {/* Vendor (read-only) */}
                        <div>
                            <label className={MODAL.label}>Vendor</label>
                            <div className="px-4 py-3.5 sm:py-4 bg-gray-100 border border-gray-200 rounded-2xl text-sm text-gray-500">
                                {vendorName}
                            </div>
                        </div>

                        {/* Subject */}
                        <div>
                            <label className={MODAL.label}>Subject <span className="text-red-500">*</span></label>
                            <input
                                type="text"
                                value={subject}
                                onChange={(e) => setSubject(e.target.value)}
                                placeholder="Ticket subject"
                                maxLength={200}
                                className={MODAL.inputBase}
                                disabled={!canEdit || isSubmitting || isCompleting || isDeleting}
                            />
                            <p className="mt-1 text-xs text-gray-400 text-right">{subject.length}/200</p>
                        </div>

                        {/* Deadline */}
                        <div>
                            <label className={MODAL.label}>Deadline</label>
                            {canEdit ? (
                                <DateTimePickerBoxes
                                    value={deadline}
                                    onChange={(val) => setDeadline(val)}
                                    onError={(err) => setDateError(err)}
                                />
                            ) : (
                                <div className="px-4 py-3.5 sm:py-4 bg-gray-100 border border-gray-200 rounded-2xl text-sm text-gray-500">
                                    {ticket.deadline ? new Date(ticket.deadline).toLocaleDateString() : "No deadline"}
                                </div>
                            )}
                        </div>

                        {/* Status (read-only) */}
                        <div>
                            <label className={MODAL.label}>Status</label>
                            <div className="flex items-center gap-2">
                                <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wide", statusBadge)}>
                                    {ticket.status}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className={MODAL.footer}>
                    {error && <div className={MODAL.errorBox}>{error}</div>}

                    {showDeleteConfirm ? (
                        <div className="space-y-3">
                            <p className="text-sm text-gray-700 font-medium">
                                Are you sure you want to cancel this ticket?
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowDeleteConfirm(false)}
                                    className={MODAL.btnCancel}
                                    disabled={isDeleting}
                                >
                                    Go Back
                                </button>
                                <button
                                    onClick={handleDelete}
                                    disabled={isDeleting}
                                    className="flex-1 px-4 py-3.5 sm:py-3 rounded-2xl bg-red-600 text-white text-sm font-bold hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {isDeleting && <Loader2 className="w-4 h-4 animate-spin" />}
                                    Cancel Ticket
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {canEdit && (
                                <div className="flex gap-3">
                                    <button onClick={onClose} className={MODAL.btnCancel} disabled={isSubmitting || isCompleting}>
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleSave}
                                        disabled={isSubmitting || !subject.trim() || dateError}
                                        className={cn(
                                            "flex-1 px-4 py-3.5 sm:py-3 rounded-2xl bg-gray-900 text-white text-sm font-bold hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2",
                                            isSubmitting && "opacity-80"
                                        )}
                                    >
                                        {isSubmitting && <Loader2 className="w-4 h-4 animate-spin hidden sm:inline" />}
                                        Save Changes
                                    </button>
                                </div>
                            )}
                            {canComplete && (
                                <button
                                    onClick={handleComplete}
                                    disabled={isCompleting || isSubmitting}
                                    className="w-full px-4 py-2.5 rounded-2xl bg-emerald-600 text-white text-sm font-semibold hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {isCompleting && <Loader2 className="w-4 h-4 animate-spin" />}
                                    Mark Completed
                                </button>
                            )}
                            {canEdit && (
                                <button
                                    onClick={() => setShowDeleteConfirm(true)}
                                    className="w-full px-4 py-2.5 rounded-2xl border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50 transition-colors"
                                >
                                    Cancel Ticket
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}
