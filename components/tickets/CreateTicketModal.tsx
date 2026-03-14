"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, PlusCircle, Search, ChevronDown } from "lucide-react";
import { useCreateTicket } from "@/lib/hooks/useTickets";
import { useVendors } from "@/lib/hooks/useVendors";
import { getTodayMidnightISO } from "@/lib/date-utils";
import DateTimePickerBoxes from "@/components/ui/DateTimePickerBoxes";
import { cn } from "@/lib/utils";
import type { Vendor } from "@/lib/types";

interface CreateTicketModalProps {
    isOpen: boolean;
    onClose: () => void;
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

export default function CreateTicketModal({ isOpen, onClose }: CreateTicketModalProps) {
    const [mounted, setMounted] = useState(false);
    const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
    const [vendorSearch, setVendorSearch] = useState("");
    const [showVendorDropdown, setShowVendorDropdown] = useState(false);
    const [subject, setSubject] = useState("");
    const [deadline, setDeadline] = useState("");
    const [dateError, setDateError] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const isSubmittingRef = useRef(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const createTicket = useCreateTicket();
    const { data: vendorData, isLoading: vendorsLoading } = useVendors();
    const activeVendors = (vendorData?.vendors || []).filter(v => v.status === 'active');

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (isOpen) {
            setSelectedVendor(null);
            setVendorSearch("");
            setShowVendorDropdown(false);
            setSubject("");
            setDeadline(getTodayMidnightISO());
            setDateError(false);
            setError(null);
        }
    }, [isOpen]);

    // Close dropdown on outside click
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setShowVendorDropdown(false);
            }
        };
        if (showVendorDropdown) {
            document.addEventListener("mousedown", handleClick);
            return () => document.removeEventListener("mousedown", handleClick);
        }
    }, [showVendorDropdown]);

    const filteredVendors = activeVendors.filter(v => {
        const q = vendorSearch.toLowerCase();
        return (
            (v.name?.toLowerCase().includes(q)) ||
            v.phone_number.includes(q)
        );
    });

    const handleSubmit = async () => {
        if (isSubmittingRef.current) return;
        setError(null);

        if (!selectedVendor) {
            setError("Please select a vendor");
            return;
        }
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

        createTicket.mutate(
            {
                vendor_id: selectedVendor.id,
                subject: subject.trim(),
                deadline: deadline || undefined,
            },
            {
                onSuccess: () => onClose(),
                onError: (err) => setError(err instanceof Error ? err.message : "Failed to create ticket"),
                onSettled: () => {
                    isSubmittingRef.current = false;
                    setIsSubmitting(false);
                },
            }
        );
    };

    if (!mounted || !isOpen) return null;

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
                                <PlusCircle className="w-5 h-5 text-gray-900" />
                            </div>
                            <div>
                                <h3 className={MODAL.title}>Create Ticket</h3>
                                <p className={MODAL.subtitle}>Track a vendor obligation</p>
                            </div>
                        </div>
                    </div>
                    <button onClick={onClose} className={MODAL.closeBtn}>
                        <X className="w-5 h-5 cursor-pointer" />
                    </button>
                </div>

                <div className={MODAL.body}>
                    <div className="space-y-5">
                        {/* Vendor selector */}
                        <div>
                            <label className={MODAL.label}>Vendor <span className="text-red-500">*</span></label>
                            {selectedVendor ? (
                                <div className="flex items-center justify-between px-4 py-3 rounded-2xl border border-gray-200 bg-gray-50/80 min-w-0 gap-2">
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-vendor-200 to-vendor-300 flex items-center justify-center shrink-0">
                                            <span className="text-sm font-black text-vendor-700 uppercase">
                                                {(selectedVendor.name || selectedVendor.phone_number).substring(0, 2)}
                                            </span>
                                        </div>
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-sm sm:text-[15px] font-bold text-gray-900 truncate">
                                                {selectedVendor.name || selectedVendor.phone_number}
                                            </span>
                                            {selectedVendor.name && (
                                                <span className="text-xs text-gray-500">{selectedVendor.phone_number}</span>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            setSelectedVendor(null);
                                            setShowVendorDropdown(true);
                                        }}
                                        className="text-sm font-bold text-gray-900 hover:underline transition-all shrink-0"
                                    >
                                        Change
                                    </button>
                                </div>
                            ) : (
                                <div ref={dropdownRef} className="relative z-50">
                                    <div className="relative">
                                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                        <input
                                            type="text"
                                            value={vendorSearch}
                                            onChange={(e) => {
                                                setVendorSearch(e.target.value);
                                                setShowVendorDropdown(true);
                                            }}
                                            onFocus={() => setShowVendorDropdown(true)}
                                            placeholder={vendorsLoading ? "Loading vendors..." : "Search vendors..."}
                                            className={cn(MODAL.inputBase, "pl-10")}
                                            disabled={isSubmitting}
                                        />
                                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                    </div>

                                    {showVendorDropdown && (
                                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-2xl shadow-lg max-h-48 overflow-y-auto z-50">
                                            {filteredVendors.length === 0 ? (
                                                <div className="px-4 py-3 text-sm text-gray-500">
                                                    {vendorsLoading ? "Loading..." : "No active vendors found"}
                                                </div>
                                            ) : (
                                                filteredVendors.map(vendor => (
                                                    <button
                                                        key={vendor.id}
                                                        onClick={() => {
                                                            setSelectedVendor(vendor);
                                                            setShowVendorDropdown(false);
                                                            setVendorSearch("");
                                                        }}
                                                        className="w-full px-4 py-2.5 text-left hover:bg-gray-50 flex items-center gap-3 transition-colors first:rounded-t-2xl last:rounded-b-2xl"
                                                    >
                                                        <div className="w-8 h-8 rounded-lg bg-vendor-100 flex items-center justify-center shrink-0">
                                                            <span className="text-xs font-bold text-vendor-700 uppercase">
                                                                {(vendor.name || vendor.phone_number).substring(0, 2)}
                                                            </span>
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className="text-sm font-semibold text-gray-900 truncate">
                                                                {vendor.name || vendor.phone_number}
                                                            </div>
                                                            {vendor.name && (
                                                                <div className="text-xs text-gray-500">{vendor.phone_number}</div>
                                                            )}
                                                        </div>
                                                    </button>
                                                ))
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Subject */}
                        <div>
                            <label className={MODAL.label}>Subject <span className="text-red-500">*</span></label>
                            <input
                                type="text"
                                value={subject}
                                onChange={(e) => setSubject(e.target.value)}
                                placeholder="e.g., Invoice #1234 follow-up"
                                autoComplete="off"
                                maxLength={200}
                                className={MODAL.inputBase}
                                disabled={isSubmitting}
                            />
                            <p className="mt-1 text-xs text-gray-400 text-right">{subject.length}/200</p>
                        </div>

                        {/* Deadline */}
                        <div>
                            <label className={MODAL.label}>Deadline</label>
                            <DateTimePickerBoxes
                                value={deadline}
                                onChange={(val) => setDeadline(val)}
                                onError={(err) => setDateError(err)}
                            />
                        </div>
                    </div>
                </div>

                <div className={MODAL.footer}>
                    {error && <div className={MODAL.errorBox}>{error}</div>}
                    <div className="flex gap-3">
                        <button onClick={onClose} className={MODAL.btnCancel} disabled={isSubmitting}>Cancel</button>
                        <button
                            onClick={handleSubmit}
                            disabled={isSubmitting || !selectedVendor || !subject.trim() || dateError}
                            className={cn(
                                "flex-1 px-4 py-3.5 sm:py-3 rounded-2xl bg-gray-900 text-white text-sm font-bold hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2",
                                isSubmitting && "opacity-80"
                            )}
                        >
                            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin hidden sm:inline" />}
                            Create Ticket
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}
