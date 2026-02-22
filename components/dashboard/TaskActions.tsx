"use client";

/**
 * TaskActions — Context menu with role-based actions for tasks.
 *
 * Action rules:
 *   ASSIGNEE + pending:     Accept (set deadline), Reject (add remark), Create Subtask
 *   ASSIGNEE + accepted:    Edit Deadline, Create Subtask
 *   OWNER (multi-person):   Mark Complete, Edit Persons, Delete
 *   TODO (self-assigned):   Mark Complete, Edit Deadline, Edit Persons
 *
 * All modals use a unified mobile-first bottom-sheet pattern for uniformity.
 */

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
    MoreHorizontal,
    Calendar,
    CheckCircle2,
    PlusCircle,
    XCircle,
    UserPlus,
    Trash2,
    Loader2,
    X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { type Task } from "@/lib/types";
import { useUserContext } from "@/lib/user-context";
import {
    getAvailableActions,
    type TaskActionType,
} from "@/lib/task-service";
import SearchEmployee from "@/components/dashboard/SearchEmployee";
import { type OrgUser } from "@/lib/hierarchy";
import { getTodayMidnightISO } from "@/lib/date-utils";
import DateTimePickerBoxes from "@/components/ui/DateTimePickerBoxes";

// ── Shared style tokens for uniform modal styling ────────────────────────────
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

function makeBtnPrimary(color: string) {
    return `flex-1 px-4 py-3.5 sm:py-3 rounded-2xl ${color} text-white text-sm font-bold hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2`;
}

// ─── Icon mapping ───────────────────────────────────────────────────────────

const ACTION_META: Record<
    TaskActionType,
    { icon: typeof Calendar; color: string }
> = {
    accept: { icon: CheckCircle2, color: "text-emerald-600 hover:bg-emerald-50" },
    reject: { icon: XCircle, color: "text-red-500 hover:bg-red-50" },
    complete: { icon: CheckCircle2, color: "text-emerald-600 hover:bg-emerald-50" },
    edit_deadline: { icon: Calendar, color: "text-blue-600 hover:bg-blue-50" },
    create_subtask: { icon: PlusCircle, color: "text-teal-600 hover:bg-teal-50" },
    edit_persons: { icon: UserPlus, color: "text-violet-600 hover:bg-violet-50" },
    delete: { icon: Trash2, color: "text-red-500 hover:bg-red-50" },
};

// ─── Helper ─────────────────────────────────────────────────────────────────

function extractUserId(
    userRef: string | { id: string } | unknown
): string | null {
    if (!userRef) return null;
    if (typeof userRef === "string") return userRef;
    if (Array.isArray(userRef)) return userRef[0]?.id || null;
    if (typeof userRef === "object" && userRef !== null && "id" in userRef)
        return (userRef as Record<string, unknown>).id as string;
    return null;
}

function PortalModal({ children }: { children: React.ReactNode }) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    if (!mounted) return null;
    return createPortal(children, document.body);
}

// ─── ModalShell — unified modal container ────────────────────────────────────
function ModalShell({
    onClose,
    children,
}: {
    onClose: () => void;
    children: React.ReactNode;
}) {
    return (
        <div className={MODAL.overlay}>
            <div className="absolute inset-0" onClick={onClose} />
            <div className={MODAL.panel}>
                <div className={MODAL.dragHandle}>
                    <div className={MODAL.dragPill} />
                </div>
                {children}
            </div>
        </div>
    );
}

// ─── Main Component ─────────────────────────────────────────────────────────

interface TaskActionsProps {
    task: Task;
    currentUserId: string;
}

export default function TaskActions({ task, currentUserId }: TaskActionsProps) {
    const router = useRouter();
    const { orgUsers, allOrgUsers } = useUserContext();
    const [open, setOpen] = useState(false);
    const [modal, setModal] = useState<
        | "accept"
        | "reject"
        | "edit_deadline"
        | "create_subtask"
        | "edit_persons"
        | "delete"
        | null
    >(null);
    const [loading, setLoading] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(e.target as Node)
            ) {
                setOpen(false);
            }
        }
        if (open) document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [open]);

    // Compute available actions using the central service
    const actions = getAvailableActions(task, currentUserId);

    // ── Action handlers ─────────────────────────────────────────────────────

    async function handleAccept(deadline: string) {
        setLoading(true);
        await fetch(`/api/tasks/${task.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "accept",
                committed_deadline: deadline,
            }),
        });
        setModal(null);
        setLoading(false);
        router.refresh();
    }

    async function handleReject(reason: string) {
        setLoading(true);
        await fetch(`/api/tasks/${task.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "reject", reject_reason: reason }),
        });
        setModal(null);
        setLoading(false);
        router.refresh();
    }

    async function handleComplete() {
        setLoading(true);
        await fetch(`/api/tasks/${task.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "complete" }),
        });
        setLoading(false);
        router.refresh();
    }

    async function handleEditDeadline(deadline: string) {
        setLoading(true);
        await fetch(`/api/tasks/${task.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "edit_deadline",
                new_deadline: deadline,
            }),
        });
        setModal(null);
        setLoading(false);
        router.refresh();
    }

    async function handleCreateSubtask(
        assignedToId: string,
        title: string,
        description: string,
        deadline: string
    ) {
        setLoading(true);
        await fetch(`/api/tasks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                parent_task_id: task.id,
                assigned_to: assignedToId,
                title,
                description,
                deadline,
            }),
        });
        setModal(null);
        setLoading(false);
        router.refresh();
    }

    async function handleEditPersons(newAssigneeId: string) {
        setLoading(true);
        await fetch(`/api/tasks/${task.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "edit_persons",
                new_assigned_to: newAssigneeId,
            }),
        });
        setModal(null);
        setLoading(false);
        router.refresh();
    }

    async function handleRemovePerson() {
        // Remove assignee = reassign to self (owner), converting to a to-do
        const ownerId = extractUserId(task.created_by);
        if (!ownerId) return;
        setLoading(true);
        await fetch(`/api/tasks/${task.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "edit_persons",
                new_assigned_to: ownerId,
            }),
        });
        setModal(null);
        setLoading(false);
        router.refresh();
    }

    async function handleDelete() {
        setLoading(true);
        await fetch(`/api/tasks/${task.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "delete" }),
        });
        setModal(null);
        setLoading(false);
        router.refresh();
    }

    // Map action type → click handler
    function handleActionClick(type: TaskActionType) {
        setOpen(false);
        switch (type) {
            case "accept":
                setModal("accept");
                break;
            case "reject":
                setModal("reject");
                break;
            case "complete":
                handleComplete();
                break;
            case "edit_deadline":
                setModal("edit_deadline");
                break;
            case "create_subtask":
                setModal("create_subtask");
                break;
            case "edit_persons":
                setModal("edit_persons");
                break;
            case "delete":
                setModal("delete");
                break;
        }
    }

    return (
        <>
            <div className="relative" ref={dropdownRef}>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setOpen(!open);
                    }}
                    className={cn(
                        "p-2 rounded-xl transition-all duration-200",
                        open
                            ? "bg-gray-900 text-white"
                            : "text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                    )}
                    disabled={loading}
                >
                    {loading ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                        <MoreHorizontal className="w-5 h-5" />
                    )}
                </button>

                {open && (
                    <div className="absolute right-0 top-full mt-1 z-40 bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden min-w-[200px]">
                        {actions.length === 0 ? (
                            <div className="px-4 py-3 text-sm text-gray-400 font-medium">
                                No actions available
                            </div>
                        ) : (
                            actions.map((action) => {
                                const meta = ACTION_META[action.type];
                                const Icon = meta.icon;
                                return (
                                    <button
                                        key={action.type}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleActionClick(action.type);
                                        }}
                                        className={cn(
                                            "w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold transition-colors",
                                            meta.color
                                        )}
                                    >
                                        <Icon className="w-4 h-4 shrink-0" />
                                        {action.label}
                                    </button>
                                );
                            })
                        )}
                    </div>
                )}
            </div>

            {/* ── Modals ── */}
            {modal === "accept" && (
                <PortalModal>
                    <AcceptTaskModal
                        onSubmit={handleAccept}
                        onClose={() => setModal(null)}
                        loading={loading}
                    />
                </PortalModal>
            )}
            {modal === "reject" && (
                <PortalModal>
                    <RejectTaskModal
                        onSubmit={handleReject}
                        onClose={() => setModal(null)}
                        loading={loading}
                    />
                </PortalModal>
            )}
            {modal === "edit_deadline" && (
                <PortalModal>
                    <EditDeadlineModal
                        onSubmit={handleEditDeadline}
                        onClose={() => setModal(null)}
                        loading={loading}
                        originalDeadline={task.committed_deadline || task.deadline}
                    />
                </PortalModal>
            )}
            {modal === "create_subtask" && (
                <PortalModal>
                    <CreateSubtaskModal
                        onSubmit={handleCreateSubtask}
                        onClose={() => setModal(null)}
                        loading={loading}
                        orgUsers={allOrgUsers}
                        currentUserId={currentUserId}
                    />
                </PortalModal>
            )}
            {modal === "edit_persons" && (
                <PortalModal>
                    <EditPersonsModal
                        onSubmit={handleEditPersons}
                        onRemove={handleRemovePerson}
                        onClose={() => setModal(null)}
                        loading={loading}
                        orgUsers={orgUsers}
                        currentUserId={currentUserId}
                        task={task}
                    />
                </PortalModal>
            )}
            {modal === "delete" && (
                <PortalModal>
                    <DeleteConfirmModal
                        onConfirm={handleDelete}
                        onClose={() => setModal(null)}
                        loading={loading}
                        taskTitle={task.title}
                    />
                </PortalModal>
            )}
        </>
    );
}

// ─── Accept Task Modal ──────────────────────────────────────────────────────

function AcceptTaskModal({
    onSubmit,
    onClose,
    loading,
}: {
    onSubmit: (deadline: string) => void;
    onClose: () => void;
    loading: boolean;
}) {
    const [deadline, setDeadline] = useState(getTodayMidnightISO());
    const [error, setError] = useState("");
    const [dateError, setDateError] = useState(false);

    const handleSubmit = () => {
        try {
            if (dateError || !deadline) throw new Error("Please fill out the full deadline correctly");
            setError("");
            onSubmit(deadline);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };

    return (
        <ModalShell onClose={onClose}>
            <div className={MODAL.header}>
                <div>
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-emerald-50">
                            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div>
                            <h3 className={MODAL.title}>Accept Task</h3>
                            <p className={MODAL.subtitle}>Set a deadline to accept this task</p>
                        </div>
                    </div>
                </div>
                <button onClick={onClose} className={MODAL.closeBtn}>
                    <X className="w-5 h-5 cursor-pointer" />
                </button>
            </div>

            <div className={MODAL.body}>
                {error && <div className={MODAL.errorBox}>{error}</div>}
                <label className={MODAL.label}>Committed Deadline</label>
                <DateTimePickerBoxes
                    value={deadline}
                    onChange={(val) => setDeadline(val)}
                    onError={(err) => setDateError(err)}
                />
            </div>

            <div className={MODAL.footer}>
                <div className="flex gap-3">
                    <button onClick={onClose} className={MODAL.btnCancel}>Cancel</button>
                    <button onClick={handleSubmit} disabled={loading || dateError} className={makeBtnPrimary("bg-emerald-600")}>
                        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                        Accept
                    </button>
                </div>
            </div>
        </ModalShell>
    );
}

// ─── Reject Task Modal ──────────────────────────────────────────────────────

function RejectTaskModal({
    onSubmit,
    onClose,
    loading,
}: {
    onSubmit: (reason: string) => void;
    onClose: () => void;
    loading: boolean;
}) {
    const [reason, setReason] = useState("");

    return (
        <ModalShell onClose={onClose}>
            <div className={MODAL.header}>
                <div>
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-red-50">
                            <XCircle className="w-5 h-5 text-red-500" />
                        </div>
                        <div>
                            <h3 className={MODAL.title}>Reject Task</h3>
                            <p className={MODAL.subtitle}>Provide a reason for rejecting</p>
                        </div>
                    </div>
                </div>
                <button onClick={onClose} className={MODAL.closeBtn}>
                    <X className="w-5 h-5 cursor-pointer" />
                </button>
            </div>

            <div className={MODAL.body}>
                <label className={MODAL.label}>Reason for Rejection</label>
                <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why are you rejecting this task?"
                    rows={3}
                    className={MODAL.textareaBase}
                />
            </div>

            <div className={MODAL.footer}>
                <div className="flex gap-3">
                    <button onClick={onClose} className={MODAL.btnCancel}>Cancel</button>
                    <button
                        onClick={() => onSubmit(reason)}
                        disabled={loading || !reason.trim()}
                        className={makeBtnPrimary("bg-red-500")}
                    >
                        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                        Reject
                    </button>
                </div>
            </div>
        </ModalShell>
    );
}

// ─── Edit Deadline Modal ────────────────────────────────────────────────────

function EditDeadlineModal({
    onSubmit,
    onClose,
    loading,
    originalDeadline,
}: {
    onSubmit: (deadline: string) => void;
    onClose: () => void;
    loading: boolean;
    originalDeadline?: string | null;
}) {
    const defaultDate = originalDeadline
        ? new Date(originalDeadline).toISOString()
        : getTodayMidnightISO();
    const [deadline, setDeadline] = useState(defaultDate);
    const [error, setError] = useState("");
    const [dateError, setDateError] = useState(false);

    const handleSubmit = () => {
        try {
            if (dateError || !deadline) throw new Error("Please fill out the full deadline correctly");
            setError("");
            onSubmit(deadline);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };

    return (
        <ModalShell onClose={onClose}>
            <div className={MODAL.header}>
                <div>
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-blue-50">
                            <Calendar className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                            <h3 className={MODAL.title}>Edit Deadline</h3>
                            <p className={MODAL.subtitle}>Update the deadline for this task</p>
                        </div>
                    </div>
                </div>
                <button onClick={onClose} className={MODAL.closeBtn}>
                    <X className="w-5 h-5 cursor-pointer" />
                </button>
            </div>

            <div className={MODAL.body}>
                {error && <div className={MODAL.errorBox}>{error}</div>}
                <label className={MODAL.label}>New Deadline</label>
                <DateTimePickerBoxes
                    value={deadline}
                    onChange={(val) => setDeadline(val)}
                    onError={(err) => setDateError(err)}
                />
            </div>

            <div className={MODAL.footer}>
                <div className="flex gap-3">
                    <button onClick={onClose} className={MODAL.btnCancel}>Cancel</button>
                    <button onClick={handleSubmit} disabled={loading || dateError} className={makeBtnPrimary("bg-blue-600")}>
                        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                        Save
                    </button>
                </div>
            </div>
        </ModalShell>
    );
}

// ─── Create Subtask Modal ───────────────────────────────────────────────────

function CreateSubtaskModal({
    onSubmit,
    onClose,
    loading,
    orgUsers,
    currentUserId,
}: {
    onSubmit: (
        assignedToId: string,
        title: string,
        description: string,
        deadline: string
    ) => void;
    onClose: () => void;
    loading: boolean;
    orgUsers: OrgUser[];
    currentUserId: string;
}) {
    const [assignedTo, setAssignedTo] = useState<OrgUser | null>(null);
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [deadline, setDeadline] = useState(getTodayMidnightISO());
    const [isSearching, setIsSearching] = useState(false);
    const [error, setError] = useState("");
    const [dateError, setDateError] = useState(false);

    const isSelfAssigned = assignedTo?.id === currentUserId;

    const handleSubmit = () => {
        try {
            if (!assignedTo) throw new Error("Please select an assignee");
            if (!title.trim()) throw new Error("Task title is required");
            if (isSelfAssigned && (dateError || !deadline)) throw new Error("Please fill out the full deadline correctly");
            setError("");
            onSubmit(assignedTo.id, title, description, isSelfAssigned ? deadline : "");
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };

    return (
        <ModalShell onClose={onClose}>
            <div className={MODAL.header}>
                <div>
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-teal-50">
                            <PlusCircle className="w-5 h-5 text-teal-600" />
                        </div>
                        <div>
                            <h3 className={MODAL.title}>Create Subtask</h3>
                            <p className={MODAL.subtitle}>Assign a subtask to an employee</p>
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
                    {/* Assignee Selection */}
                    <div>
                        <label className={MODAL.label}>Assign To</label>
                        {!assignedTo || isSearching ? (
                            <div className="relative z-50">
                                <SearchEmployee
                                    orgUsers={orgUsers}
                                    currentUserId={currentUserId}
                                    includeSelf={true}
                                    isHeader={false}
                                    onSelect={(user) => {
                                        setAssignedTo(user);
                                        setIsSearching(false);
                                    }}
                                />
                                {assignedTo && (
                                    <button
                                        className="absolute right-0 top-0 mt-[1.125rem] mr-4 text-xs font-semibold text-gray-400 hover:text-gray-600 transition-colors"
                                        onClick={() => setIsSearching(false)}
                                    >
                                        Cancel
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="flex items-center justify-between px-4 py-3 rounded-2xl border border-gray-200 bg-gray-50/80">
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center shrink-0">
                                        {isSelfAssigned ? (
                                            <span className="text-sm font-black text-gray-700 p-0">ME</span>
                                        ) : (
                                            <span className="text-sm font-black text-gray-700 uppercase">
                                                {assignedTo.name.substring(0, 2)}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-sm sm:text-[15px] font-bold text-gray-900">
                                            {isSelfAssigned ? "Me (Self)" : assignedTo.name}
                                        </span>
                                        {!isSelfAssigned && (
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

                    <div>
                        <label className={MODAL.label}>Task Title</label>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="What needs to be done?"
                            className={MODAL.inputBase}
                        />
                    </div>

                    <div>
                        <label className={MODAL.label}>Description</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Add more details about this task..."
                            rows={3}
                            className={MODAL.textareaBase}
                        />
                    </div>

                    {/* Only show deadline if creating a to-do (assigned to self) */}
                    {isSelfAssigned && (
                        <div>
                            <label className={MODAL.label}>Deadline</label>
                            <DateTimePickerBoxes
                                value={deadline}
                                onChange={(val) => setDeadline(val)}
                                onError={(err) => setDateError(err)}
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Hide footer while user is actively searching (no assignee picked yet) to give mobile users more space */}
            {(!isSearching || assignedTo) && (
                <div className={MODAL.footer}>
                    <div className="flex gap-3">
                        <button onClick={onClose} className={MODAL.btnCancel}>Cancel</button>
                        <button
                            onClick={handleSubmit}
                            disabled={loading || !assignedTo || !title.trim() || (isSelfAssigned && dateError)}
                            className={makeBtnPrimary("bg-teal-600")}
                        >
                            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                            {isSelfAssigned ? "Create To-do" : "Assign Subtask"}
                        </button>
                    </div>
                </div>
            )}
        </ModalShell>
    );
}

// ─── Edit Persons Modal ─────────────────────────────────────────────────────

function EditPersonsModal({
    onSubmit,
    onRemove,
    onClose,
    loading,
    orgUsers,
    currentUserId,
    task,
}: {
    onSubmit: (newAssigneeId: string) => void;
    onRemove: () => void;
    onClose: () => void;
    loading: boolean;
    orgUsers: OrgUser[];
    currentUserId: string;
    task: Task;
}) {
    const [selected, setSelected] = useState<OrgUser | null>(null);
    const [showSearch, setShowSearch] = useState(false);

    // Resolve current assignee details
    const currentAssigneeId = extractUserId(task.assigned_to);
    const currentOwnerId = extractUserId(task.created_by);
    const isTaskOwner = currentOwnerId === currentUserId;
    const isSelfAssigned = currentAssigneeId === currentOwnerId;

    // Find current assignee from orgUsers for display
    const currentAssignee = orgUsers.find(u => u.id === currentAssigneeId);
    const assigneeName = currentAssignee?.name
        || (typeof task.assigned_to === "object" && task.assigned_to?.name)
        || null;
    const assigneeRole = currentAssignee?.role || "member";

    return (
        <ModalShell onClose={onClose}>
            <div className={MODAL.header}>
                <div>
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-violet-50">
                            <UserPlus className="w-5 h-5 text-violet-600" />
                        </div>
                        <div>
                            <h3 className={MODAL.title}>Edit Persons</h3>
                            <p className={MODAL.subtitle}>Manage the assigned person</p>
                        </div>
                    </div>
                </div>
                <button onClick={onClose} className={MODAL.closeBtn}>
                    <X className="w-5 h-5 cursor-pointer" />
                </button>
            </div>

            <div className={MODAL.body}>
                {/* Current Assignee Section */}
                {currentAssigneeId && !isSelfAssigned && (
                    <div className="mb-5">
                        <label className={MODAL.label}>Current Assignee</label>
                        <div className="flex items-center justify-between px-4 py-3 rounded-2xl border border-gray-200 bg-gray-50/80">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-100 to-violet-200 flex items-center justify-center shrink-0">
                                    <span className="text-sm font-black text-violet-700 uppercase">
                                        {assigneeName ? assigneeName.substring(0, 2) : "??"}
                                    </span>
                                </div>
                                <div className="flex flex-col min-w-0">
                                    <span className="text-sm font-semibold text-gray-900 break-words">
                                        {assigneeName || "Unknown"}
                                    </span>
                                    <span className="text-xs text-gray-500 capitalize">
                                        {assigneeRole}
                                    </span>
                                </div>
                            </div>
                            {isTaskOwner && (
                                <button
                                    onClick={onRemove}
                                    disabled={loading}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 transition-colors disabled:opacity-50 shrink-0 ml-2"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    Remove
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Add / Replace Assignee Section */}
                <label className={MODAL.label}>
                    {currentAssigneeId && !isSelfAssigned ? "Replace With" : "Assign To"}
                </label>
                {!selected && !showSearch ? (
                    <button
                        onClick={() => setShowSearch(true)}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl border-2 border-dashed border-gray-200 text-sm font-semibold text-gray-500 hover:border-violet-300 hover:text-violet-600 hover:bg-violet-50/30 transition-all"
                    >
                        <UserPlus className="w-4 h-4" />
                        Search Employee
                    </button>
                ) : !selected ? (
                    <div className="relative z-50">
                        <SearchEmployee
                            orgUsers={orgUsers}
                            currentUserId={currentUserId}
                            isHeader={false}
                            onSelect={(user) => {
                                setSelected(user);
                                setShowSearch(false);
                            }}
                        />
                        <button
                            className="absolute right-0 top-0 mt-[1.125rem] mr-4 text-xs font-semibold text-gray-400 hover:text-gray-600 transition-colors"
                            onClick={() => setShowSearch(false)}
                        >
                            Cancel
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center justify-between px-4 py-3 rounded-2xl border border-violet-200 bg-violet-50/50">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-100 to-violet-200 flex items-center justify-center shrink-0">
                                <span className="text-sm font-black text-violet-700 uppercase">
                                    {selected.name.substring(0, 2)}
                                </span>
                            </div>
                            <div className="flex flex-col min-w-0">
                                <span className="text-sm font-semibold text-gray-900 break-words">
                                    {selected.name}
                                </span>
                                <span className="text-xs text-gray-500 capitalize">
                                    {selected.role}
                                </span>
                            </div>
                        </div>
                        <button
                            onClick={() => setSelected(null)}
                            className="text-xs font-bold text-violet-600 hover:text-violet-700 transition-colors shrink-0 ml-2"
                        >
                            Change
                        </button>
                    </div>
                )}

                {selected && (
                    <p className="text-xs text-gray-400 mt-3">
                        {selected.id === currentOwnerId
                            ? "⚡ Assigning to yourself will convert this to a personal to-do."
                            : "The new assignee will need to accept the task."}
                    </p>
                )}
            </div>

            <div className={MODAL.footer}>
                <div className="flex gap-3">
                    <button onClick={onClose} className={MODAL.btnCancel}>Cancel</button>
                    <button
                        onClick={() => onSubmit(selected!.id)}
                        disabled={loading || !selected}
                        className={makeBtnPrimary("bg-violet-600")}
                    >
                        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                        Update
                    </button>
                </div>
            </div>
        </ModalShell>
    );
}

// ─── Delete Confirmation Modal ──────────────────────────────────────────────

function DeleteConfirmModal({
    onConfirm,
    onClose,
    loading,
    taskTitle,
}: {
    onConfirm: () => void;
    onClose: () => void;
    loading: boolean;
    taskTitle: string;
}) {
    return (
        <ModalShell onClose={onClose}>
            <div className={MODAL.header}>
                <div>
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-red-50">
                            <Trash2 className="w-5 h-5 text-red-500" />
                        </div>
                        <div>
                            <h3 className={MODAL.title}>Delete Task</h3>
                            <p className={MODAL.subtitle}>This will cancel the task and all subtasks</p>
                        </div>
                    </div>
                </div>
                <button onClick={onClose} className={MODAL.closeBtn}>
                    <X className="w-5 h-5 cursor-pointer" />
                </button>
            </div>

            <div className={MODAL.body}>
                <div className="p-4 bg-red-50 border border-red-100 rounded-2xl">
                    <p className="text-sm text-gray-700">
                        Are you sure you want to delete{" "}
                        <strong>&quot;{taskTitle}&quot;</strong>? This action
                        cannot be undone.
                    </p>
                </div>
            </div>

            <div className={MODAL.footer}>
                <div className="flex gap-3">
                    <button onClick={onClose} className={MODAL.btnCancel}>Cancel</button>
                    <button onClick={onConfirm} disabled={loading} className={makeBtnPrimary("bg-red-500")}>
                        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                        Delete
                    </button>
                </div>
            </div>
        </ModalShell>
    );
}
