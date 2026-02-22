"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import SearchEmployee from "@/components/dashboard/SearchEmployee";
import { type OrgUser } from "@/lib/hierarchy";
import { getTodayMidnightISO } from "@/lib/date-utils";
import DateTimePickerBoxes from "@/components/ui/DateTimePickerBoxes";

interface TaskUser extends OrgUser {
    avatar_url?: string | null;
}

interface CreateTaskModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentUserId: string;
}

export default function CreateTaskModal({ isOpen, onClose, currentUserId }: CreateTaskModalProps) {
    const router = useRouter();
    const [mounted, setMounted] = useState(false);

    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");

    // Default deadline to 7 days from now
    const [deadline, setDeadline] = useState("");

    // Initially no one is assigned
    const [assignedTo, setAssignedTo] = useState<TaskUser | null>(null);
    const [isSearching, setIsSearching] = useState(false);
    const [dateError, setDateError] = useState(false);

    const [users, setUsers] = useState<TaskUser[]>([]);
    const [isLoadingUsers, setIsLoadingUsers] = useState(false);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setMounted(true);
    }, []);

    // Fetch users when the modal opens
    useEffect(() => {
        if (isOpen && users.length === 0) {
            fetchUsers();

            // Re-initialize state when modal opens
            setTitle("");
            setDescription("");
            setAssignedTo(null); // No default assignment
            setIsSearching(false);
            setDeadline(getTodayMidnightISO());
            setDateError(false);
            setError(null);
        }
    }, [isOpen, users.length]);

    const fetchUsers = async () => {
        setIsLoadingUsers(true);
        try {
            const res = await fetch("/api/users");
            if (res.ok) {
                const data = await res.json();
                setUsers(data.users || []);
            }
        } catch (error) {
            console.error("Failed to fetch users", error);
        } finally {
            setIsLoadingUsers(false);
        }
    };

    if (!isOpen || !mounted) return null;

    const isSelfAssigned = assignedTo?.id === currentUserId;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!title.trim()) {
            setError("Task title is required");
            return;
        }

        if (!assignedTo) {
            setError("Assignee is required");
            return;
        }

        if (isSelfAssigned && !deadline) {
            setError("Deadline is required when assigning a task to yourself");
            return;
        }

        if (isSelfAssigned && dateError) {
            setError("Please fill out the full deadline correctly");
            return;
        }

        setIsSubmitting(true);

        try {
            const res = await fetch("/api/tasks", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    title: title.trim(),
                    description: description.trim() || undefined,
                    assigned_to: assignedTo.id,
                    deadline: deadline ? deadline : undefined,
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to create task");
            }

            // Success
            router.refresh();
            onClose();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "An unexpected error occurred");
        } finally {
            setIsSubmitting(false);
        }
    };

    const modalContent = (
        <div className="fixed inset-0 z-[9999] flex items-end justify-center sm:items-center bg-gray-900/40 sm:p-4 backdrop-blur-sm sm:animate-fade-in transition-all duration-300">
            {/* Backdrop click to close */}
            <div className="absolute inset-0" onClick={onClose} />

            <div className="relative w-full sm:max-w-md bg-white rounded-t-[2rem] shadow-2xl sm:rounded-3xl flex flex-col max-h-[92vh] sm:max-h-[85vh] z-10 overflow-hidden sm:animate-scale-in animate-slide-up-mobile">

                {/* Mobile Drag Handle */}
                <div className="sm:hidden w-full flex justify-center py-3 bg-white relative z-20">
                    <div className="w-12 h-1.5 bg-gray-200 rounded-full" />
                </div>

                {/* Header */}
                <div className="flex items-center justify-between px-6 pb-4 sm:pt-6 border-b border-gray-100 bg-white relative z-20 shrink-0">
                    <h2 className="text-2xl font-extrabold tracking-tight text-gray-900">Create Task</h2>
                    <button
                        onClick={onClose}
                        className="p-2 sm:p-2.5 -mr-2 sm:-mr-1 bg-gray-50 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-all duration-200 flex-shrink-0"
                    >
                        <X className="w-5 h-5 sm:w-5 sm:h-5 cursor-pointer" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1 bg-white overscroll-contain">
                    {error && (
                        <div className="mb-5 p-4 bg-red-50/80 text-red-700 rounded-2xl text-sm font-medium border border-red-100/50">
                            {error}
                        </div>
                    )}

                    <div className="space-y-6">
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-gray-900 block">
                                Assign To <span className="text-red-500">*</span>
                            </label>

                            {!assignedTo || isSearching ? (
                                <div className="space-y-3 relative">
                                    <div className="relative">
                                        <SearchEmployee
                                            orgUsers={users}
                                            // Pass empty string so they can search for themselves
                                            currentUserId={""}
                                            isHeader={false}
                                            onSelect={(user) => {
                                                setAssignedTo(user as TaskUser);
                                                setIsSearching(false);
                                            }}
                                        />
                                        {assignedTo && (
                                            <button
                                                className="absolute right-0 top-0 mt-[1.125rem] mr-4 text-xs font-semibold text-gray-400 hover:text-gray-600 transition-colors z-10"
                                                onClick={() => setIsSearching(false)}
                                            >
                                                Cancel
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center justify-between px-4 py-3 rounded-2xl border border-gray-200 bg-gray-50/80">
                                    <div className="flex items-center gap-3">
                                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center shrink-0">
                                            {assignedTo.id === currentUserId ? (
                                                <span className="text-sm font-black text-gray-700 p-0">ME</span>
                                            ) : (
                                                <span className="text-sm font-black text-gray-700 uppercase">
                                                    {assignedTo.name.substring(0, 2)}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[15px] font-bold text-gray-900">
                                                {assignedTo.id === currentUserId ? "Me (Self)" : assignedTo.name}
                                            </span>
                                            {assignedTo.id !== currentUserId && (
                                                <span className="text-xs text-gray-500 capitalize">
                                                    {assignedTo.role || "member"}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setIsSearching(true)}
                                        className="text-sm font-bold text-gray-900 hover:underline transition-all"
                                    >
                                        Change
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="title" className="text-sm font-bold text-gray-900 block">
                                Task Title <span className="text-red-500">*</span>
                            </label>
                            <input
                                id="title"
                                type="text"
                                placeholder="What needs to be done?"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                className="w-full px-4 py-4 bg-gray-50/50 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 focus:bg-white transition-all text-[15px] font-medium placeholder:font-normal placeholder:text-gray-400"
                                disabled={isSubmitting}
                            />
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="description" className="text-sm font-bold text-gray-900 block">
                                Description <span className="text-gray-400 font-medium">(Optional)</span>
                            </label>
                            <textarea
                                id="description"
                                placeholder="Add more details about this task..."
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={3}
                                className="w-full px-4 py-4 bg-gray-50/50 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 focus:bg-white transition-all text-[15px] resize-none placeholder:text-gray-400"
                                disabled={isSubmitting}
                            />
                        </div>

                        {/* Only show deadline if creating a to-do (assigned to self) */}
                        {isSelfAssigned && (
                            <div className="space-y-2 pb-2">
                                <label htmlFor="deadline" className="text-sm font-bold text-gray-900 block">
                                    Deadline <span className="text-red-500">*</span>
                                </label>
                                <DateTimePickerBoxes
                                    value={deadline}
                                    onChange={(val) => setDeadline(val)}
                                    onError={(err) => setDateError(err)}
                                />
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-6 border-t border-gray-100 bg-white sm:bg-gray-50/50 mt-auto relative z-20 pb-8 sm:pb-6 shrink-0">
                    <button
                        onClick={handleSubmit}
                        disabled={
                            isLoadingUsers ||
                            isSubmitting ||
                            !assignedTo ||
                            !title.trim() ||
                            (isSelfAssigned && dateError)
                        }
                        className="w-full flex items-center justify-center py-[18px] sm:py-4 px-6 bg-gray-900 text-white rounded-2xl font-bold text-[15px] hover:bg-gray-800 disabled:opacity-70 disabled:cursor-not-allowed transition-all shadow-lg shadow-gray-900/20 active:scale-[0.98]"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="w-5 h-5 mr-3 animate-spin" />
                                Creating Task...
                            </>
                        ) : (
                            "Create Task"
                        )}
                    </button>
                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}
