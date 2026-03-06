"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { X, Loader2, PlusCircle } from "lucide-react";
import SearchEmployee from "@/components/dashboard/SearchEmployee";
import { useUserContext } from "@/lib/user-context";
import { type TaskUser, type Task } from "@/lib/types";
import { getTodayMidnightISO } from "@/lib/date-utils";
import DateTimePickerBoxes from "@/components/ui/DateTimePickerBoxes";
import { cn } from "@/lib/utils";

interface CreateTaskModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentUserId: string;
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
    textareaBase: "w-full px-4 py-3.5 sm:py-4 bg-gray-50/50 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 focus:bg-white transition-all text-sm sm:text-[15px] resize-none placeholder:text-gray-400",
    btnCancel: "flex-1 px-4 py-3.5 sm:py-3 rounded-2xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors",
    errorBox: "mb-4 p-3.5 bg-red-50/80 text-red-700 rounded-2xl text-sm font-medium border border-red-100/50",
};

export default function CreateTaskModal({ isOpen, onClose, currentUserId }: CreateTaskModalProps) {
    const router = useRouter();
    const queryClient = useQueryClient();

    const [mounted, setMounted] = useState(false);
    const { allOrgUsers, isLoading: isLoadingUsers } = useUserContext();

    // Form state
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [deadline, setDeadline] = useState("");

    const [assignedTo, setAssignedTo] = useState<TaskUser | null>(null);
    const [isSearching, setIsSearching] = useState(false);
    const [dateError, setDateError] = useState(false);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setMounted(true);
    }, []);

    const users = allOrgUsers || [];

    useEffect(() => {
        if (isOpen) {
            setTitle("");
            setDescription("");
            setAssignedTo(null);
            setIsSearching(false);
            setDeadline(getTodayMidnightISO());
            setDateError(false);
            setError(null);
        }
    }, [isOpen]);

    const isSelfAssigned = assignedTo?.id === currentUserId;

    // Need to use the user's session ID to correctly snapshot the cache
    const currentQueryKey = ["dashboard", currentUserId];

    const createMutation = useMutation({
        mutationFn: async ({ title, description, assigned_to, deadline }: Record<string, unknown>) => {
            const res = await fetch("/api/tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title, description, assigned_to, deadline }),
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to create task");
            }
            return res.json();
        },
        onMutate: async (variables) => {
            await queryClient.cancelQueries({ queryKey: currentQueryKey });
            const previousDashboardData = queryClient.getQueryData(currentQueryKey);

            setMounted(true); // Close any lingering visual blockers if needed

            queryClient.setQueryData(currentQueryKey, (oldData: { profile?: Record<string, unknown>; tasks?: Task[]; allOrgTasks?: Task[] } | undefined) => {
                if (!oldData) return oldData;

                const mockTask: Task = {
                    id: `temp-${Date.now()}`,
                    title: String(variables.title),
                    description: variables.description ? String(variables.description) : null,
                    status: "pending",
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    parent_task_id: null,
                    created_by: currentUserId,
                    assigned_to: String(variables.assigned_to),
                    deadline: variables.deadline ? String(variables.deadline) : null,
                    organisation_id: oldData.profile?.organisation_id ? String(oldData.profile.organisation_id) : "",
                    committed_deadline: null
                };

                return {
                    ...oldData,
                    tasks: [mockTask, ...(oldData.tasks || [])],
                    allOrgTasks: [mockTask, ...(oldData.allOrgTasks || [])]
                };
            });

            // Close the modal immediately for 0 latency feel
            onClose();

            return { previousDashboardData };
        },
        onError: (err: unknown, variables: Record<string, unknown>, context: unknown) => {
            setError(err instanceof Error ? err.message : "An unexpected error occurred");
            if (context && typeof context === 'object' && 'previousDashboardData' in context) {
                const ctx = context as { previousDashboardData: unknown };
                if (ctx.previousDashboardData) {
                    queryClient.setQueryData(currentQueryKey, ctx.previousDashboardData);
                }
            }
        },
        onSettled: () => {
            setIsSubmitting(false);
            queryClient.invalidateQueries({ queryKey: currentQueryKey });
            router.refresh();
        }
    });

    const handleSubmit = async () => {
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

        createMutation.mutate({
            title: title.trim(),
            description: description.trim() || undefined,
            assigned_to: assignedTo.id,
            deadline: deadline ? deadline : undefined,
        });
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
                                <h3 className={MODAL.title}>Create Task</h3>
                                <p className={MODAL.subtitle}>Assign a task to an employee</p>
                            </div>
                        </div>
                    </div>
                    <button onClick={onClose} className={MODAL.closeBtn}>
                        <X className="w-5 h-5 cursor-pointer" />
                    </button>
                </div>

                <div className={MODAL.body}>
                    {error && <div className={MODAL.errorBox}>{error}</div>}

                    <div className="space-y-5">
                        <div>
                            <label className={MODAL.label}>Assign To <span className="text-red-500">*</span></label>
                            {!assignedTo || isSearching ? (
                                <div className="relative z-50">
                                    <SearchEmployee
                                        orgUsers={users}
                                        currentUserId={currentUserId}
                                        includeSelf={true}
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
                            ) : (
                                <div className="flex items-center justify-between px-4 py-3 rounded-2xl border border-gray-200 bg-gray-50/80 min-w-0 gap-2">
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center shrink-0">
                                            {isSelfAssigned ? (
                                                <span className="text-sm font-black text-gray-700 p-0">ME</span>
                                            ) : (
                                                <span className="text-sm font-black text-gray-700 uppercase">
                                                    {assignedTo.first_name ? assignedTo.first_name[0] + (assignedTo.last_name ? assignedTo.last_name[0] : '') : assignedTo.name.substring(0, 2)}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-sm sm:text-[15px] font-bold text-gray-900 truncate">
                                                {isSelfAssigned ? "Me (Self)" : (assignedTo.first_name ? `${assignedTo.first_name} ${assignedTo.last_name || ''}`.trim() : assignedTo.name)}
                                            </span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setIsSearching(true)}
                                        className="text-sm font-bold text-gray-900 hover:underline transition-all shrink-0"
                                    >
                                        Change
                                    </button>
                                </div>
                            )}
                        </div>

                        <div>
                            <label className={MODAL.label}>Task Title <span className="text-red-500">*</span></label>
                            <input
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="What needs to be done?"
                                autoComplete="off"
                                autoCorrect="on"
                                enterKeyHint="next"
                                className={MODAL.inputBase}
                                disabled={isSubmitting}
                            />
                        </div>

                        <div>
                            <label className={MODAL.label}>Description <span className="text-gray-400 font-medium normal-case">(Optional)</span></label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Add more details about this task..."
                                rows={3}
                                autoComplete="off"
                                autoCorrect="on"
                                spellCheck={true}
                                className={MODAL.textareaBase}
                                disabled={isSubmitting}
                            />
                        </div>

                        {isSelfAssigned && (
                            <div>
                                <label className={MODAL.label}>Deadline <span className="text-red-500">*</span></label>
                                <DateTimePickerBoxes
                                    value={deadline}
                                    onChange={(val) => setDeadline(val)}
                                    onError={(err) => setDateError(err)}
                                />
                            </div>
                        )}
                    </div>
                </div>

                {(!isSearching || assignedTo) && (
                    <div className={MODAL.footer}>
                        <div className="flex gap-3">
                            <button onClick={onClose} className={MODAL.btnCancel} disabled={isSubmitting}>Cancel</button>
                            <button
                                onClick={handleSubmit}
                                disabled={isLoadingUsers || isSubmitting || !assignedTo || !title.trim() || (isSelfAssigned && dateError)}
                                className={cn(
                                    "flex-1 px-4 py-3.5 sm:py-3 rounded-2xl bg-gray-900 text-white text-sm font-bold hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2",
                                    isSubmitting && "opacity-80"
                                )}
                            >
                                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin hidden sm:inline" />}
                                Create Task
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}
