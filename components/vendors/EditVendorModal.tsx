"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Pencil } from "lucide-react";
import { useEditVendor, useDeleteVendor } from "@/lib/hooks/useVendors";
import { cn } from "@/lib/utils";
import type { Vendor } from "@/lib/types";

interface EditVendorModalProps {
    isOpen: boolean;
    onClose: () => void;
    vendor: Vendor | null;
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

export default function EditVendorModal({ isOpen, onClose, vendor }: EditVendorModalProps) {
    const [mounted, setMounted] = useState(false);
    const [name, setName] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const isSubmittingRef = useRef(false);

    const editVendor = useEditVendor();
    const deleteVendor = useDeleteVendor();

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (isOpen && vendor) {
            setName(vendor.name || "");
            setError(null);
            setShowDeleteConfirm(false);
        }
    }, [isOpen, vendor]);

    const handleSave = async () => {
        if (isSubmittingRef.current || !vendor) return;
        setError(null);

        if (!name.trim()) {
            setError("Name is required");
            return;
        }

        isSubmittingRef.current = true;
        setIsSubmitting(true);

        editVendor.mutate(
            { vendorId: vendor.id, name: name.trim() },
            {
                onSuccess: () => onClose(),
                onError: (err) => setError(err instanceof Error ? err.message : "Failed to update vendor"),
                onSettled: () => {
                    isSubmittingRef.current = false;
                    setIsSubmitting(false);
                },
            }
        );
    };

    const handleDelete = async () => {
        if (!vendor) return;
        setError(null);
        setIsDeleting(true);

        deleteVendor.mutate(vendor.id, {
            onSuccess: () => onClose(),
            onError: (err) => {
                setError(err instanceof Error ? err.message : "Failed to remove vendor");
                setShowDeleteConfirm(false);
            },
            onSettled: () => setIsDeleting(false),
        });
    };

    if (!mounted || !isOpen || !vendor) return null;

    const statusBadge = vendor.status === 'active'
        ? "bg-emerald-100 text-emerald-700 border-emerald-200"
        : vendor.status === 'pending'
            ? "bg-amber-100 text-amber-700 border-amber-200"
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
                                <h3 className={MODAL.title}>Edit Vendor</h3>
                                <p className={MODAL.subtitle}>{vendor.phone_number}</p>
                            </div>
                        </div>
                    </div>
                    <button onClick={onClose} className={MODAL.closeBtn}>
                        <X className="w-5 h-5 cursor-pointer" />
                    </button>
                </div>

                <div className={MODAL.body}>
                    <div className="space-y-5">
                        <div>
                            <label className={MODAL.label}>Name</label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Vendor name"
                                autoComplete="name"
                                className={MODAL.inputBase}
                                disabled={isSubmitting || isDeleting}
                            />
                        </div>

                        <div>
                            <label className={MODAL.label}>Phone Number</label>
                            <div className="px-4 py-3.5 sm:py-4 bg-gray-100 border border-gray-200 rounded-2xl text-sm text-gray-500">
                                {vendor.phone_number}
                            </div>
                        </div>

                        <div>
                            <label className={MODAL.label}>Status</label>
                            <div className="flex items-center gap-2">
                                <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wide", statusBadge)}>
                                    {vendor.status}
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
                                Are you sure you want to remove this vendor?
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowDeleteConfirm(false)}
                                    className={MODAL.btnCancel}
                                    disabled={isDeleting}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleDelete}
                                    disabled={isDeleting}
                                    className="flex-1 px-4 py-3.5 sm:py-3 rounded-2xl bg-red-600 text-white text-sm font-bold hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {isDeleting && <Loader2 className="w-4 h-4 animate-spin" />}
                                    Remove Vendor
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="flex gap-3">
                                <button onClick={onClose} className={MODAL.btnCancel} disabled={isSubmitting}>
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={isSubmitting || !name.trim()}
                                    className={cn(
                                        "flex-1 px-4 py-3.5 sm:py-3 rounded-2xl bg-gray-900 text-white text-sm font-bold hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2",
                                        isSubmitting && "opacity-80"
                                    )}
                                >
                                    {isSubmitting && <Loader2 className="w-4 h-4 animate-spin hidden sm:inline" />}
                                    Save Changes
                                </button>
                            </div>
                            <button
                                onClick={() => setShowDeleteConfirm(true)}
                                className="w-full px-4 py-2.5 rounded-2xl border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50 transition-colors"
                            >
                                Remove Vendor
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}
