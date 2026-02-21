"use client";

import { Plus, X } from "lucide-react";

interface CreateTaskModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function CreateTaskModal({ isOpen, onClose }: CreateTaskModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-gray-900/60 p-4 animate-fade-in sm:p-0 backdrop-blur-sm">
            <div
                className="absolute inset-0"
                onClick={onClose}
            />

            <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl animate-scale-in p-6 z-10 border border-gray-100">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold tracking-tight text-gray-900">Create Task</h2>
                    <button
                        onClick={onClose}
                        className="p-2 -mr-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-8 text-center bg-gray-50 border border-dashed border-gray-200 rounded-2xl">
                    <div className="w-12 h-12 bg-white flex items-center justify-center rounded-full mx-auto shadow-sm border border-gray-100 mb-3">
                        <Plus className="w-6 h-6 text-gray-400" />
                    </div>
                    <h3 className="text-sm font-semibold text-gray-900 mb-1">Coming Soon</h3>
                    <p className="text-sm text-gray-500">
                        Full task creation via WhatsApp or Dashboard will be available shortly!
                    </p>
                </div>
            </div>
        </div>
    );
}
