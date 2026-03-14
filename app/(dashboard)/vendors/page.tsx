"use client";

import { useState, useMemo } from "react";
import { Users, Plus, Search } from "lucide-react";
import { useVendors } from "@/lib/hooks/useVendors";
import { VendorCard, VendorCardSkeleton } from "@/components/vendors/VendorCard";
import AddVendorModal from "@/components/vendors/AddVendorModal";
import EditVendorModal from "@/components/vendors/EditVendorModal";
import type { Vendor } from "@/lib/types";

export default function VendorsPage() {
    const { data, isLoading } = useVendors();
    const vendors = useMemo(() => data?.vendors || [], [data]);

    const [searchQuery, setSearchQuery] = useState("");
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);

    const filteredVendors = useMemo(() => {
        if (!searchQuery.trim()) return vendors;
        const q = searchQuery.toLowerCase();
        return vendors.filter(v =>
            (v.name?.toLowerCase().includes(q)) ||
            v.phone_number.includes(q)
        );
    }, [vendors, searchQuery]);

    return (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">
                    Vendors
                </h1>
                <button
                    onClick={() => setShowAddModal(true)}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-900 text-white text-sm font-bold rounded-xl hover:opacity-90 transition-all"
                >
                    <Plus className="w-4 h-4" />
                    Add Vendor
                </button>
            </div>

            {/* Search */}
            {vendors.length > 0 && (
                <div className="relative mb-5">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search vendors..."
                        className="w-full pl-10 pr-4 py-3 bg-gray-50/50 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 focus:bg-white transition-all text-sm placeholder:text-gray-400"
                    />
                </div>
            )}

            {/* Loading */}
            {isLoading && (
                <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <VendorCardSkeleton key={i} />
                    ))}
                </div>
            )}

            {/* Empty state */}
            {!isLoading && vendors.length === 0 && (
                <div className="text-center py-16">
                    <Users className="mx-auto h-12 w-12 text-gray-300" />
                    <h3 className="text-sm font-semibold text-gray-900 mt-3">No vendors yet</h3>
                    <p className="text-sm text-gray-500 mt-1">
                        Add your first vendor to start tracking shipments and payments.
                    </p>
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="mt-4 px-4 py-2 bg-gray-900 text-white text-sm font-bold rounded-xl hover:opacity-90 transition-all"
                    >
                        + Add Vendor
                    </button>
                </div>
            )}

            {/* No search results */}
            {!isLoading && vendors.length > 0 && filteredVendors.length === 0 && (
                <div className="text-center py-12">
                    <Search className="mx-auto h-8 w-8 text-gray-300" />
                    <p className="text-sm text-gray-500 mt-2">
                        No vendors match your search.
                    </p>
                </div>
            )}

            {/* Vendor list */}
            {!isLoading && filteredVendors.length > 0 && (
                <div className="space-y-3">
                    {filteredVendors.map(vendor => (
                        <VendorCard
                            key={vendor.id}
                            vendor={vendor}
                            onEdit={setEditingVendor}
                            onDelete={setEditingVendor}
                        />
                    ))}
                </div>
            )}

            {/* Modals */}
            <AddVendorModal
                isOpen={showAddModal}
                onClose={() => setShowAddModal(false)}
            />
            <EditVendorModal
                isOpen={!!editingVendor}
                onClose={() => setEditingVendor(null)}
                vendor={editingVendor}
            />
        </div>
    );
}
