"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
    Building2,
    Users,
    ChevronRight,
    Phone,
    Clock,
    RefreshCw,
    Search,
    Activity,
    ListTodo,
    MessageSquare,
    Bell,
    FileText,
    CheckCircle2,
    XCircle,
    AlertCircle,
    ArrowLeft,
    ChevronDown,
    ChevronUp,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Org {
    id: string;
    name: string;
    slug: string;
    created_at: string;
    user_count: number;
    active_task_count: number;
    total_task_count: number;
}

interface OrgUser {
    id: string;
    name: string;
    first_name: string | null;
    last_name: string | null;
    phone_number: string;
    role: string;
    reporting_manager_id: string | null;
    manager_name: string | null;
    created_at: string;
    avatar_url: string | null;
    task_stats: { created: number; assigned: number; active: number };
}

interface UserTask {
    id: string;
    title: string;
    status: string;
    deadline: string | null;
    committed_deadline: string | null;
    created_at: string;
    updated_at: string;
    source: string;
    parent_task_id: string | null;
    role: "owner" | "assignee" | "todo";
    other_person: string | null;
}

interface TimelineEntry {
    type: "audit" | "message" | "notification";
    timestamp: string;
    data: Record<string, unknown>;
}

interface ActivityData {
    user: { id: string; name: string; phone_number: string; organisation_id: string };
    tasks: UserTask[];
    timeline: TimelineEntry[];
    counts: { audit: number; messages: number; notifications: number; tasks: number };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
    });
}

function statusBadge(status: string) {
    const styles: Record<string, string> = {
        pending: "bg-amber-50 text-amber-700 border-amber-200",
        accepted: "bg-blue-50 text-blue-700 border-blue-200",
        completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
        rejected: "bg-red-50 text-red-700 border-red-200",
        cancelled: "bg-gray-100 text-gray-500 border-gray-200",
        overdue: "bg-rose-50 text-rose-700 border-rose-200",
        sent: "bg-emerald-50 text-emerald-700 border-emerald-200",
        failed: "bg-red-50 text-red-700 border-red-200",
    };
    return styles[status] || "bg-gray-100 text-gray-600 border-gray-200";
}

function roleBadge(role: string) {
    const styles: Record<string, string> = {
        owner: "bg-green-50 text-green-700 border-green-200",
        assignee: "bg-indigo-50 text-indigo-700 border-indigo-200",
        todo: "bg-violet-50 text-violet-700 border-violet-200",
        key_partner: "bg-amber-50 text-amber-700 border-amber-200",
        other_partner: "bg-blue-50 text-blue-700 border-blue-200",
        manager: "bg-purple-50 text-purple-700 border-purple-200",
        member: "bg-gray-100 text-gray-600 border-gray-200",
    };
    return styles[role] || "bg-gray-100 text-gray-600 border-gray-200";
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function MonitorPage() {
    // State
    const [orgs, setOrgs] = useState<Org[]>([]);
    const [users, setUsers] = useState<OrgUser[]>([]);
    const [activity, setActivity] = useState<ActivityData | null>(null);
    const [selectedOrg, setSelectedOrg] = useState<Org | null>(null);
    const [selectedUser, setSelectedUser] = useState<OrgUser | null>(null);
    const [activeTab, setActiveTab] = useState<"tasks" | "activity">("tasks");
    const [loading, setLoading] = useState({ orgs: true, users: false, activity: false });
    const [orgSearch, setOrgSearch] = useState("");
    const [userSearch, setUserSearch] = useState("");
    const [lastRefresh, setLastRefresh] = useState(new Date());
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [mobileView, setMobileView] = useState<"orgs" | "users" | "detail">("orgs");
    const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

    // Fetch orgs
    const fetchOrgs = useCallback(async () => {
        setLoading((l) => ({ ...l, orgs: true }));
        try {
            const res = await fetch("/api/monitor/organisations");
            const data = await res.json();
            setOrgs(data.organisations || []);
        } catch (e) {
            console.error("Failed to fetch orgs:", e);
        }
        setLoading((l) => ({ ...l, orgs: false }));
        setLastRefresh(new Date());
    }, []);

    // Fetch users for an org
    const fetchUsers = useCallback(async (orgId: string) => {
        setLoading((l) => ({ ...l, users: true }));
        try {
            const res = await fetch(`/api/monitor/users?orgId=${orgId}`);
            const data = await res.json();
            setUsers(data.users || []);
        } catch (e) {
            console.error("Failed to fetch users:", e);
        }
        setLoading((l) => ({ ...l, users: false }));
    }, []);

    // Fetch activity for a user
    const fetchActivity = useCallback(async (userId: string) => {
        setLoading((l) => ({ ...l, activity: true }));
        try {
            const res = await fetch(`/api/monitor/activity?userId=${userId}`);
            const data = await res.json();
            setActivity(data);
        } catch (e) {
            console.error("Failed to fetch activity:", e);
        }
        setLoading((l) => ({ ...l, activity: false }));
    }, []);

    // Initial load
    useEffect(() => {
        fetchOrgs();
    }, [fetchOrgs]);

    // Auto-refresh
    useEffect(() => {
        if (autoRefresh) {
            refreshTimer.current = setInterval(() => {
                fetchOrgs();
                if (selectedOrg) fetchUsers(selectedOrg.id);
                if (selectedUser) fetchActivity(selectedUser.id);
            }, 30000);
        }
        return () => {
            if (refreshTimer.current) clearInterval(refreshTimer.current);
        };
    }, [autoRefresh, selectedOrg, selectedUser, fetchOrgs, fetchUsers, fetchActivity]);

    // Handlers
    const handleSelectOrg = (org: Org) => {
        setSelectedOrg(org);
        setSelectedUser(null);
        setActivity(null);
        setUserSearch("");
        fetchUsers(org.id);
        setMobileView("users");
    };

    const handleSelectUser = (user: OrgUser) => {
        setSelectedUser(user);
        fetchActivity(user.id);
        setMobileView("detail");
    };

    const handleRefresh = () => {
        fetchOrgs();
        if (selectedOrg) fetchUsers(selectedOrg.id);
        if (selectedUser) fetchActivity(selectedUser.id);
    };

    // Filter
    const filteredOrgs = orgs.filter(
        (o) => o.name?.toLowerCase().includes(orgSearch.toLowerCase()) || o.slug?.toLowerCase().includes(orgSearch.toLowerCase())
    );
    const filteredUsers = users.filter(
        (u) =>
            u.name?.toLowerCase().includes(userSearch.toLowerCase()) ||
            u.phone_number?.includes(userSearch) ||
            u.first_name?.toLowerCase().includes(userSearch.toLowerCase()) ||
            u.last_name?.toLowerCase().includes(userSearch.toLowerCase())
    );

    return (
        <div className="min-h-screen bg-[#fdfdfd]">
            {/* Header */}
            <div className="sticky top-0 z-30 backdrop-blur-xl bg-white/80 border-b border-gray-100">
                <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <a href="/huehue" className="text-gray-400 hover:text-gray-900 transition-colors">
                            <ArrowLeft className="w-5 h-5" />
                        </a>
                        <div>
                            <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-gray-900">
                                Platform Monitor
                            </h1>
                            <p className="text-xs text-gray-400 font-medium">
                                Last updated {lastRefresh.toLocaleTimeString("en-IN")}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setAutoRefresh(!autoRefresh)}
                            className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${
                                autoRefresh
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : "bg-gray-50 text-gray-500 border-gray-200"
                            }`}
                        >
                            {autoRefresh ? "Auto 30s" : "Paused"}
                        </button>
                        <button
                            onClick={handleRefresh}
                            className="p-2 rounded-xl hover:bg-gray-100 transition-colors text-gray-500 hover:text-gray-900"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading.orgs ? "animate-spin" : ""}`} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Mobile back navigation */}
            <div className="lg:hidden px-4 py-2 flex items-center gap-2 border-b border-gray-100 bg-white">
                {mobileView === "users" && (
                    <button
                        onClick={() => { setMobileView("orgs"); setSelectedOrg(null); setUsers([]); }}
                        className="flex items-center gap-1 text-sm font-semibold text-gray-500 hover:text-gray-900"
                    >
                        <ArrowLeft className="w-4 h-4" /> Orgs
                    </button>
                )}
                {mobileView === "detail" && (
                    <button
                        onClick={() => { setMobileView("users"); setSelectedUser(null); setActivity(null); }}
                        className="flex items-center gap-1 text-sm font-semibold text-gray-500 hover:text-gray-900"
                    >
                        <ArrowLeft className="w-4 h-4" /> Users
                    </button>
                )}
                {mobileView === "orgs" && (
                    <span className="text-sm font-semibold text-gray-400">
                        {orgs.length} organisation{orgs.length !== 1 ? "s" : ""}
                    </span>
                )}
            </div>

            {/* Three-panel layout */}
            <div className="max-w-[1600px] mx-auto flex flex-col lg:flex-row h-[calc(100vh-64px)]">
                {/* Panel 1: Organisations */}
                <div
                    className={`lg:w-[280px] xl:w-[320px] lg:border-r border-gray-100 flex flex-col overflow-hidden ${
                        mobileView !== "orgs" ? "hidden lg:flex" : "flex"
                    }`}
                >
                    <div className="p-3 border-b border-gray-100">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search orgs..."
                                value={orgSearch}
                                onChange={(e) => setOrgSearch(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gray-900 focus:bg-white transition-all placeholder:text-gray-400"
                            />
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-1">
                        {loading.orgs && orgs.length === 0 ? (
                            <SkeletonList count={5} />
                        ) : filteredOrgs.length === 0 ? (
                            <EmptyState icon={Building2} text="No organisations found" />
                        ) : (
                            filteredOrgs.map((org) => (
                                <button
                                    key={org.id}
                                    onClick={() => handleSelectOrg(org)}
                                    className={`w-full text-left p-3 rounded-2xl border transition-all group ${
                                        selectedOrg?.id === org.id
                                            ? "bg-gray-900 text-white border-gray-900"
                                            : "bg-white border-gray-100 hover:border-gray-300 hover:shadow-sm"
                                    }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="font-bold text-sm truncate">{org.name}</span>
                                        <ChevronRight
                                            className={`w-4 h-4 flex-shrink-0 ${
                                                selectedOrg?.id === org.id ? "text-gray-400" : "text-gray-300 group-hover:text-gray-500"
                                            }`}
                                        />
                                    </div>
                                    <div className="flex items-center gap-3 mt-1.5">
                                        <span
                                            className={`text-xs font-medium flex items-center gap-1 ${
                                                selectedOrg?.id === org.id ? "text-gray-300" : "text-gray-400"
                                            }`}
                                        >
                                            <Users className="w-3 h-3" />
                                            {org.user_count}
                                        </span>
                                        <span
                                            className={`text-xs font-medium flex items-center gap-1 ${
                                                selectedOrg?.id === org.id ? "text-gray-300" : "text-gray-400"
                                            }`}
                                        >
                                            <ListTodo className="w-3 h-3" />
                                            {org.active_task_count}/{org.total_task_count}
                                        </span>
                                        <span
                                            className={`text-xs font-medium ${
                                                selectedOrg?.id === org.id ? "text-gray-400" : "text-gray-300"
                                            }`}
                                        >
                                            {timeAgo(org.created_at)}
                                        </span>
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>

                {/* Panel 2: Users */}
                <div
                    className={`lg:w-[320px] xl:w-[360px] lg:border-r border-gray-100 flex flex-col overflow-hidden ${
                        mobileView !== "users" ? "hidden lg:flex" : "flex"
                    }`}
                >
                    {!selectedOrg ? (
                        <div className="flex-1 flex items-center justify-center">
                            <EmptyState icon={Building2} text="Select an organisation" />
                        </div>
                    ) : (
                        <>
                            <div className="p-3 border-b border-gray-100">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                    <input
                                        type="text"
                                        placeholder="Search users..."
                                        value={userSearch}
                                        onChange={(e) => setUserSearch(e.target.value)}
                                        className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gray-900 focus:bg-white transition-all placeholder:text-gray-400"
                                    />
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                                {loading.users ? (
                                    <SkeletonList count={4} />
                                ) : filteredUsers.length === 0 ? (
                                    <EmptyState icon={Users} text="No users found" />
                                ) : (
                                    filteredUsers.map((user) => (
                                        <button
                                            key={user.id}
                                            onClick={() => handleSelectUser(user)}
                                            className={`w-full text-left p-3 rounded-2xl border transition-all ${
                                                selectedUser?.id === user.id
                                                    ? "bg-gray-900 text-white border-gray-900"
                                                    : "bg-white border-gray-100 hover:border-gray-300 hover:shadow-sm"
                                            }`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <span className="font-bold text-sm truncate">
                                                    {user.name || `${user.first_name || ""} ${user.last_name || ""}`.trim() || "Unnamed"}
                                                </span>
                                                <span
                                                    className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                                                        selectedUser?.id === user.id
                                                            ? "bg-white/10 text-white/80 border-white/20"
                                                            : roleBadge(user.role)
                                                    }`}
                                                >
                                                    {user.role}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 mt-1.5">
                                                <span
                                                    className={`text-xs font-medium flex items-center gap-1 ${
                                                        selectedUser?.id === user.id ? "text-gray-300" : "text-gray-400"
                                                    }`}
                                                >
                                                    <Phone className="w-3 h-3" />
                                                    {user.phone_number}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-3 mt-1">
                                                {user.manager_name && (
                                                    <span
                                                        className={`text-xs ${
                                                            selectedUser?.id === user.id ? "text-gray-400" : "text-gray-400"
                                                        }`}
                                                    >
                                                        Mgr: {user.manager_name}
                                                    </span>
                                                )}
                                                <span
                                                    className={`text-xs font-medium ${
                                                        selectedUser?.id === user.id ? "text-gray-300" : "text-gray-400"
                                                    }`}
                                                >
                                                    {user.task_stats.active} active
                                                </span>
                                            </div>
                                        </button>
                                    ))
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* Panel 3: Detail */}
                <div
                    className={`flex-1 flex flex-col overflow-hidden ${
                        mobileView !== "detail" ? "hidden lg:flex" : "flex"
                    }`}
                >
                    {!selectedUser ? (
                        <div className="flex-1 flex items-center justify-center">
                            <EmptyState icon={Activity} text="Select a user to view details" />
                        </div>
                    ) : (
                        <>
                            {/* User header */}
                            <div className="p-4 border-b border-gray-100 bg-white">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h2 className="text-lg font-extrabold text-gray-900">
                                            {selectedUser.name || `${selectedUser.first_name || ""} ${selectedUser.last_name || ""}`.trim()}
                                        </h2>
                                        <div className="flex items-center gap-3 mt-1">
                                            <span className="text-sm text-gray-500 flex items-center gap-1">
                                                <Phone className="w-3.5 h-3.5" />
                                                +91 {selectedUser.phone_number}
                                            </span>
                                            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${roleBadge(selectedUser.role)}`}>
                                                {selectedUser.role}
                                            </span>
                                        </div>
                                    </div>
                                    {activity && (
                                        <div className="flex items-center gap-2 text-xs text-gray-400">
                                            <span className="flex items-center gap-1">
                                                <ListTodo className="w-3.5 h-3.5" /> {activity.counts.tasks}
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <FileText className="w-3.5 h-3.5" /> {activity.counts.audit}
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <MessageSquare className="w-3.5 h-3.5" /> {activity.counts.messages}
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <Bell className="w-3.5 h-3.5" /> {activity.counts.notifications}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Tabs */}
                            <div className="flex border-b border-gray-100 bg-white px-4">
                                <button
                                    onClick={() => setActiveTab("tasks")}
                                    className={`px-4 py-2.5 text-sm font-bold border-b-2 transition-all ${
                                        activeTab === "tasks"
                                            ? "border-gray-900 text-gray-900"
                                            : "border-transparent text-gray-400 hover:text-gray-600"
                                    }`}
                                >
                                    Tasks
                                </button>
                                <button
                                    onClick={() => setActiveTab("activity")}
                                    className={`px-4 py-2.5 text-sm font-bold border-b-2 transition-all ${
                                        activeTab === "activity"
                                            ? "border-gray-900 text-gray-900"
                                            : "border-transparent text-gray-400 hover:text-gray-600"
                                    }`}
                                >
                                    Activity
                                </button>
                            </div>

                            {/* Tab content */}
                            <div className="flex-1 overflow-y-auto p-4">
                                {loading.activity ? (
                                    <SkeletonList count={6} />
                                ) : activeTab === "tasks" ? (
                                    <TasksPanel tasks={activity?.tasks || []} />
                                ) : (
                                    <ActivityPanel timeline={activity?.timeline || []} />
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function TasksPanel({ tasks }: { tasks: UserTask[] }) {
    const [statusFilter, setStatusFilter] = useState<string>("all");

    const statuses = ["all", ...Array.from(new Set(tasks.map((t) => t.status)))];
    const filtered = statusFilter === "all" ? tasks : tasks.filter((t) => t.status === statusFilter);

    if (tasks.length === 0) {
        return <EmptyState icon={ListTodo} text="No tasks found" />;
    }

    return (
        <div className="space-y-3">
            {/* Status filter pills */}
            <div className="flex flex-wrap gap-1.5">
                {statuses.map((s) => (
                    <button
                        key={s}
                        onClick={() => setStatusFilter(s)}
                        className={`text-[11px] font-bold uppercase px-2.5 py-1 rounded-full border transition-all ${
                            statusFilter === s ? "bg-gray-900 text-white border-gray-900" : `${statusBadge(s)} hover:opacity-80`
                        }`}
                    >
                        {s} {s !== "all" ? `(${tasks.filter((t) => t.status === s).length})` : `(${tasks.length})`}
                    </button>
                ))}
            </div>

            {/* Task list */}
            <div className="space-y-1.5">
                {filtered.map((task) => (
                    <TaskRow key={task.id} task={task} />
                ))}
            </div>
        </div>
    );
}

function TaskRow({ task }: { task: UserTask }) {
    const [expanded, setExpanded] = useState(false);
    const effectiveDeadline = task.committed_deadline || task.deadline;
    const isOverdue = effectiveDeadline && new Date(effectiveDeadline) < new Date() && !["completed", "cancelled"].includes(task.status);

    const accentColor =
        task.role === "todo"
            ? "bg-violet-400"
            : task.role === "owner"
            ? "bg-emerald-400"
            : "bg-indigo-400";

    return (
        <div
            className={`rounded-2xl border bg-white transition-all ${
                isOverdue ? "border-rose-200" : "border-gray-100"
            }`}
        >
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full text-left p-3 flex items-start gap-2.5"
            >
                <div className={`w-1 h-10 rounded-full flex-shrink-0 mt-0.5 ${accentColor}`} />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-gray-900 truncate">{task.title}</span>
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border flex-shrink-0 ${statusBadge(task.status)}`}>
                            {task.status}
                        </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                        <span className={`font-medium ${roleBadge(task.role)} text-[10px] px-1.5 py-0.5 rounded-full border`}>
                            {task.role}
                        </span>
                        {task.other_person && <span>with {task.other_person}</span>}
                        {effectiveDeadline && (
                            <span className={`flex items-center gap-0.5 ${isOverdue ? "text-rose-500 font-medium" : ""}`}>
                                <Clock className="w-3 h-3" />
                                {formatDate(effectiveDeadline)}
                            </span>
                        )}
                        <span className="text-gray-300">src: {task.source}</span>
                    </div>
                </div>
                {expanded ? <ChevronUp className="w-4 h-4 text-gray-300 mt-1" /> : <ChevronDown className="w-4 h-4 text-gray-300 mt-1" />}
            </button>
            {expanded && (
                <div className="px-3 pb-3 pl-8 text-xs text-gray-500 space-y-1 border-t border-gray-50 pt-2">
                    <div><span className="font-semibold text-gray-600">ID:</span> {task.id}</div>
                    <div><span className="font-semibold text-gray-600">Created:</span> {formatDate(task.created_at)}</div>
                    {task.deadline && <div><span className="font-semibold text-gray-600">Deadline:</span> {formatDate(task.deadline)}</div>}
                    {task.committed_deadline && <div><span className="font-semibold text-gray-600">Committed:</span> {formatDate(task.committed_deadline)}</div>}
                    {task.parent_task_id && <div><span className="font-semibold text-gray-600">Parent:</span> {task.parent_task_id}</div>}
                </div>
            )}
        </div>
    );
}

function ActivityPanel({ timeline }: { timeline: TimelineEntry[] }) {
    const [typeFilter, setTypeFilter] = useState<string>("all");

    const filtered = typeFilter === "all" ? timeline : timeline.filter((t) => t.type === typeFilter);
    const counts = {
        all: timeline.length,
        audit: timeline.filter((t) => t.type === "audit").length,
        message: timeline.filter((t) => t.type === "message").length,
        notification: timeline.filter((t) => t.type === "notification").length,
    };

    if (timeline.length === 0) {
        return <EmptyState icon={Activity} text="No activity recorded" />;
    }

    return (
        <div className="space-y-3">
            {/* Type filter */}
            <div className="flex flex-wrap gap-1.5">
                {(["all", "audit", "message", "notification"] as const).map((t) => (
                    <button
                        key={t}
                        onClick={() => setTypeFilter(t)}
                        className={`text-[11px] font-bold uppercase px-2.5 py-1 rounded-full border transition-all ${
                            typeFilter === t
                                ? "bg-gray-900 text-white border-gray-900"
                                : t === "audit"
                                ? "bg-amber-50 text-amber-700 border-amber-200"
                                : t === "message"
                                ? "bg-blue-50 text-blue-700 border-blue-200"
                                : t === "notification"
                                ? "bg-purple-50 text-purple-700 border-purple-200"
                                : "bg-gray-50 text-gray-600 border-gray-200"
                        }`}
                    >
                        {t} ({counts[t]})
                    </button>
                ))}
            </div>

            {/* Timeline */}
            <div className="space-y-1">
                {filtered.map((entry, i) => (
                    <TimelineRow key={`${entry.type}-${i}`} entry={entry} />
                ))}
            </div>
        </div>
    );
}

function TimelineRow({ entry }: { entry: TimelineEntry }) {
    const [expanded, setExpanded] = useState(false);
    const d = entry.data;

    let icon: React.ReactNode;
    let accent: string;
    let summary: string;

    if (entry.type === "audit") {
        const action = (d.action as string) || "unknown";
        icon = <FileText className="w-3.5 h-3.5" />;
        accent = "border-l-amber-400";
        summary = action;
        if (d.metadata && typeof d.metadata === "object") {
            const meta = d.metadata as Record<string, unknown>;
            if (meta.title) summary += ` — "${meta.title}"`;
        }
    } else if (entry.type === "message") {
        icon = <MessageSquare className="w-3.5 h-3.5" />;
        accent = "border-l-blue-400";
        const text = (d.raw_text as string) || "";
        const intent = d.intent_type as string;
        summary = text.length > 80 ? text.slice(0, 80) + "..." : text;
        if (intent) summary += ` [${intent}]`;
        if (d.processing_error) summary += " (ERROR)";
    } else {
        icon = <Bell className="w-3.5 h-3.5" />;
        accent = "border-l-purple-400";
        const stage = d.stage as string;
        const channel = d.channel as string;
        const status = d.status as string;
        summary = `${stage}#${d.stage_number} via ${channel} — ${status}`;
    }

    return (
        <div className={`rounded-xl border border-gray-100 bg-white border-l-[3px] ${accent} transition-all`}>
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full text-left p-2.5 flex items-start gap-2"
            >
                <span className="mt-0.5 text-gray-400 flex-shrink-0">{icon}</span>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span
                            className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full border ${
                                entry.type === "audit"
                                    ? "bg-amber-50 text-amber-700 border-amber-200"
                                    : entry.type === "message"
                                    ? "bg-blue-50 text-blue-700 border-blue-200"
                                    : "bg-purple-50 text-purple-700 border-purple-200"
                            }`}
                        >
                            {entry.type}
                        </span>
                        <span className="text-xs text-gray-400">{timeAgo(entry.timestamp)}</span>
                        {entry.type === "message" && Boolean(d.processing_error) && (
                            <AlertCircle className="w-3 h-3 text-red-400" />
                        )}
                        {entry.type === "notification" && String(d.status) === "sent" && (
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        )}
                        {entry.type === "notification" && String(d.status) === "failed" && (
                            <XCircle className="w-3 h-3 text-red-400" />
                        )}
                    </div>
                    <p className="text-sm text-gray-700 mt-0.5 truncate">{summary}</p>
                </div>
                {expanded ? <ChevronUp className="w-3.5 h-3.5 text-gray-300 mt-1" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-300 mt-1" />}
            </button>
            {expanded && (
                <div className="px-3 pb-2.5 pl-8 border-t border-gray-50 pt-2">
                    <pre className="text-[11px] text-gray-500 whitespace-pre-wrap break-all bg-gray-50 p-2 rounded-lg overflow-x-auto max-h-64">
                        {JSON.stringify(d, null, 2)}
                    </pre>
                    <p className="text-[10px] text-gray-300 mt-1">{formatDate(entry.timestamp)}</p>
                </div>
            )}
        </div>
    );
}

function EmptyState({ icon: Icon, text }: { icon: React.ComponentType<{ className?: string }>; text: string }) {
    return (
        <div className="flex flex-col items-center justify-center py-12 text-gray-300">
            <Icon className="w-10 h-10 mb-2" />
            <p className="text-sm font-medium">{text}</p>
        </div>
    );
}

function SkeletonList({ count }: { count: number }) {
    return (
        <div className="space-y-1.5">
            {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="rounded-2xl border border-gray-100 bg-white p-3 animate-pulse">
                    <div className="flex items-center gap-2.5">
                        <div className="w-1 h-8 rounded-full bg-gray-200" />
                        <div className="flex-1">
                            <div className="h-3.5 bg-gray-200/70 rounded-xl w-32 mb-1.5" />
                            <div className="h-2.5 bg-gray-200/50 rounded-xl w-20" />
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
