"use client";

import { memo } from "react";
import { Phone, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import type { Vendor, VendorStatus } from "@/lib/types";

const STATUS_STYLES: Record<VendorStatus, { bar: string; badge: string; label: string }> = {
    active: {
        bar: "bg-vendor-500",
        badge: "bg-emerald-100 text-emerald-700 border-emerald-200",
        label: "Active",
    },
    pending: {
        bar: "bg-amber-400",
        badge: "bg-amber-100 text-amber-700 border-amber-200",
        label: "Pending",
    },
    inactive: {
        bar: "bg-gray-300",
        badge: "bg-gray-100 text-gray-500 border-gray-200",
        label: "Inactive",
    },
};

interface VendorCardProps {
    vendor: Vendor;
    onEdit: (vendor: Vendor) => void;
    onDelete: (vendor: Vendor) => void;
}

export const VendorCard = memo(function VendorCard({ vendor, onEdit, onDelete }: VendorCardProps) {
    const status = STATUS_STYLES[vendor.status] || STATUS_STYLES.inactive;
    const displayName = vendor.name || vendor.phone_number;
    const addedBy = typeof vendor.added_by === 'object' ? vendor.added_by.name : null;

    return (
        <div className="group relative rounded-2xl border border-gray-100 bg-white p-3 sm:p-4 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
            {/* Left accent bar */}
            <div className={cn("absolute left-0 top-3 bottom-3 w-1 rounded-full", status.bar)} />

            <div className="pl-3 flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                    {/* Name */}
                    <h3 className="font-semibold text-sm sm:text-[15px] text-gray-900 truncate">
                        {displayName}
                    </h3>

                    {/* Phone */}
                    <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
                        <Phone className="w-3 h-3" />
                        <span>{vendor.phone_number}</span>
                    </div>

                    {/* Added by + date */}
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-400">
                        {addedBy && <span>Added by {addedBy}</span>}
                        <span>{formatDistanceToNow(new Date(vendor.created_at), { addSuffix: true })}</span>
                    </div>
                </div>

                {/* Right: status badge + actions */}
                <div className="flex items-center gap-2 shrink-0">
                    <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wide", status.badge)}>
                        {status.label}
                    </span>

                    {/* Actions */}
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                            onClick={() => onEdit(vendor)}
                            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                            title="Edit vendor"
                        >
                            <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                            onClick={() => onDelete(vendor)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Remove vendor"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
});

export function VendorCardSkeleton() {
    return (
        <div className="rounded-2xl border border-gray-100 bg-white p-3 sm:p-4 animate-pulse">
            <div className="flex items-center gap-3">
                <div className="w-1 h-10 rounded-full bg-gray-200" />
                <div className="flex-1">
                    <div className="h-4 bg-gray-200/70 rounded-xl w-32 mb-2" />
                    <div className="h-3 bg-gray-200/70 rounded-xl w-24" />
                </div>
                <div className="h-5 bg-gray-200/70 rounded-full w-16" />
            </div>
        </div>
    );
}
