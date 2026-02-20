import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { format, startOfWeek, addDays, startOfDay, endOfDay, isToday, isPast, isFuture } from "date-fns";
import { Clock, Calendar as CalendarIcon, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// --- Components ---

function Greeting({ first_name }: { first_name: string }) {
    const hour = new Date().getHours();
    let greeting = "Good evening";
    if (hour < 12) greeting = "Good morning";
    else if (hour < 17) greeting = "Good afternoon";

    return (
        <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
                {greeting}, {first_name}
            </h1>
            <p className="text-gray-500 mt-1">{format(new Date(), "EEEE, d MMMM yyyy")}</p>
        </div>
    );
}

function CalendarStrip({ tasks }: { tasks: { deadline: string; status: string }[] }) {
    const start = startOfWeek(new Date(), { weekStartsOn: 1 });

    const days = Array.from({ length: 7 }).map((_, i) => {
        const date = addDays(start, i);

        // Check for tasks on this day
        const dayTasks = tasks.filter(t => {
            if (!t.deadline) return false;
            const tDate = new Date(t.deadline);
            return tDate >= startOfDay(date) && tDate <= endOfDay(date);
        });

        let dotColor = null; // null | 'red' | 'orange' | 'blue'

        if (dayTasks.length > 0) {
            if (dayTasks.some(t => t.status === 'overdue' || (isPast(new Date(t.deadline)) && !isToday(new Date(t.deadline))))) {
                dotColor = 'red';
            } else if (isToday(date)) {
                dotColor = 'orange';
            } else if (isFuture(date)) {
                dotColor = 'blue';
            } else {
                dotColor = 'blue';
            }
        }

        return {
            date,
            dayName: format(date, "EEE"),
            dayNumber: format(date, "d"),
            isToday: isToday(date),
            dotColor
        };
    });

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-8">
            <div className="flex justify-between items-center">
                {days.map((day, i) => (
                    <div key={i} className="flex flex-col items-center gap-2">
                        <span className={cn("text-xs font-medium", day.isToday ? "text-accent-600" : "text-gray-400")}>
                            {day.dayName}
                        </span>
                        <div className={cn(
                            "w-10 h-10 flex items-center justify-center rounded-xl text-sm font-semibold relative",
                            day.isToday ? "bg-accent-50 text-accent-700" : "text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer"
                        )}>
                            {day.dayNumber}
                            {day.dotColor && (
                                <span className={cn(
                                    "absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full ring-2 ring-white",
                                    day.dotColor === 'red' ? "bg-red-500" :
                                        day.dotColor === 'orange' ? "bg-orange-500" : "bg-blue-500"
                                )} />
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    const styles = {
        pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
        accepted: "bg-blue-100 text-blue-800 border-blue-200",
        overdue: "bg-red-100 text-red-800 border-red-200",
        completed: "bg-green-100 text-green-800 border-green-200",
    }[status] || "bg-gray-100 text-gray-800 border-gray-200";

    return (
        <span className={cn("px-2.5 py-0.5 rounded-full text-xs font-medium border capitalize", styles)}>
            {status}
        </span>
    );
}

function TaskCardEmpty({ message }: { message: string }) {
    return (
        <div className="p-8 text-center bg-gray-50 rounded-xl border border-dashed border-gray-200">
            <CheckCircle2 className="w-8 h-8 text-gray-400 mx-auto mb-3" />
            <p className="text-sm text-gray-500 font-medium">{message}</p>
        </div>
    );
}

// --- Main Page Component ---

export default async function HomePage() {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login");

    // Fetch User Details — try by auth id first, then fallback to phone
    let userData = null;
    const { data: byId } = await supabase
        .from("users")
        .select("name, id")
        .eq("id", user.id)
        .single();

    if (byId) {
        userData = byId;
    } else {
        // Try phone lookup with multiple formats
        const phoneCandidates: string[] = [];
        if (user.phone) {
            phoneCandidates.push(user.phone);
            if (!user.phone.startsWith('+')) phoneCandidates.push(`+${user.phone}`);
        }
        // Extract phone from test email (test_919876543210@boldo.test → +919876543210)
        if (user.email) {
            const match = user.email.match(/test_(\d+)@/);
            if (match) phoneCandidates.push(`+${match[1]}`);
        }

        for (const phone of phoneCandidates) {
            const { data: byPhone } = await supabase
                .from("users")
                .select("name, id")
                .eq("phone_number", phone)
                .single();
            if (byPhone) {
                userData = byPhone;
                break;
            }
        }
    }

    const firstName = userData?.name?.split(' ')[0] || "User";

    // Fetch Tasks for the Calendar (all my tasks with deadlines)
    const { data: allMyTasks } = await supabase
        .from("tasks")
        .select("*")
        .eq("assigned_to", userData?.id || user.id)
        .not('deadline', 'is', null);

    // Fetch Today's Tasks
    const todayStart = startOfDay(new Date()).toISOString();
    const todayEnd = endOfDay(new Date()).toISOString();

    const { data: todayTasks } = await supabase
        .from("tasks")
        .select("*, created_by(*)")
        .eq("assigned_to", userData?.id || user.id)
        .in("status", ["pending", "accepted", "overdue"])
        .gte("deadline", todayStart)
        .lte("deadline", todayEnd)
        .order("deadline", { ascending: true });

    // Fetch Pending Acceptance (assigned to me, status=pending)
    const { data: pendingTasks } = await supabase
        .from("tasks")
        .select("*, created_by(*)")
        .eq("assigned_to", userData?.id || user.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

    // Fetch Tasks I Own Need Action (created by me, assigned to someone else, status=pending)
    const { data: ownedPendingTasks } = await supabase
        .from("tasks")
        .select("*, assigned_to(*)")
        .eq("created_by", userData?.id || user.id)
        .eq("status", "pending")
        .neq("assigned_to", userData?.id || user.id)
        .order("created_at", { ascending: false });

    return (
        <div className="max-w-3xl">
            <Greeting first_name={firstName} />

            <CalendarStrip tasks={allMyTasks || []} />

            <div className="space-y-6">
                {/* Today's Tasks */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                            <CalendarIcon className="w-5 h-5 text-accent-500" />
                            Today&apos;s Tasks
                        </h2>
                        <span className="bg-white text-gray-600 px-2.5 py-1 rounded-full text-xs font-semibold border border-gray-200 shadow-sm">
                            {todayTasks?.length || 0}
                        </span>
                    </div>
                    <div className="p-6">
                        {!todayTasks || todayTasks.length === 0 ? (
                            <TaskCardEmpty message="No tasks due today 🎉" />
                        ) : (
                            <ul className="space-y-4">
                                {todayTasks.map(task => (
                                    <li key={task.id} className="flex items-center justify-between p-4 rounded-xl border border-gray-100 hover:border-gray-200 hover:shadow-sm transition-all group bg-white">
                                        <div className="flex flex-col gap-1">
                                            <p className="font-semibold text-gray-900 group-hover:text-accent-600 transition-colors">{task.title}</p>
                                            <p className="text-xs text-gray-500 flex items-center gap-1.5">
                                                <span className="font-medium text-gray-700">From: {task.created_by?.name || 'Unknown'}</span>
                                                <span className="w-1 h-1 rounded-full bg-gray-300"></span>
                                                <Clock className="w-3.5 h-3.5" />
                                                {format(new Date(task.deadline), 'h:mm a')}
                                            </p>
                                        </div>
                                        <StatusBadge status={task.status} />
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>

                {/* Pending Acceptance */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                            <AlertCircle className="w-5 h-5 text-yellow-500" />
                            Pending Acceptance
                        </h2>
                        <span className="bg-white text-gray-600 px-2.5 py-1 rounded-full text-xs font-semibold border border-gray-200 shadow-sm">
                            {pendingTasks?.length || 0}
                        </span>
                    </div>
                    <div className="p-6">
                        {!pendingTasks || pendingTasks.length === 0 ? (
                            <TaskCardEmpty message="You&apos;ve accepted all your tasks! 🙌" />
                        ) : (
                            <ul className="space-y-4">
                                {pendingTasks.map(task => (
                                    <li key={task.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border border-yellow-100 bg-yellow-50/30 gap-4">
                                        <div className="flex flex-col gap-1">
                                            <p className="font-semibold text-gray-900">{task.title}</p>
                                            <p className="text-xs text-gray-500">
                                                Assigned by <span className="font-medium text-gray-700">{task.created_by?.name || 'Unknown'}</span>
                                                {' • '}
                                                {/* A rough relative time format */}
                                                {format(new Date(task.created_at), 'MMM d, h:mm a')}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <button className="px-4 py-2 bg-white text-gray-700 text-sm font-semibold rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors shadow-sm">
                                                REJECT
                                            </button>
                                            <button className="px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-black transition-colors shadow-sm relative overflow-hidden group">
                                                <span className="relative z-10">ACCEPT</span>
                                                <div className="absolute inset-0 h-full w-full bg-white/20 scale-x-0 group-hover:scale-x-100 transition-transform origin-left rounded-lg duration-300"></div>
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>

                {/* Tasks I Own Needing Action */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                        <h2 className="text-lg font-bold text-gray-900">
                            Tasks You Assigned (Awaiting Acceptance)
                        </h2>
                        <span className="bg-white text-gray-600 px-2.5 py-1 rounded-full text-xs font-semibold border border-gray-200 shadow-sm">
                            {ownedPendingTasks?.length || 0}
                        </span>
                    </div>
                    <div className="p-6">
                        {!ownedPendingTasks || ownedPendingTasks.length === 0 ? (
                            <TaskCardEmpty message="No pending tasks assigned by you! ✨" />
                        ) : (
                            <ul className="space-y-4">
                                {ownedPendingTasks.map(task => (
                                    <li key={task.id} className="flex items-center justify-between p-4 rounded-xl border border-gray-100 bg-white">
                                        <div className="flex flex-col gap-1">
                                            <p className="font-medium text-gray-900 text-sm">{task.title}</p>
                                            <p className="text-xs text-gray-500">
                                                Waiting on <span className="font-medium text-gray-700">{task.assigned_to?.name || 'Unknown'}</span>
                                            </p>
                                        </div>
                                        <span className="text-xs text-gray-400">
                                            {format(new Date(task.created_at), 'MMM d, h:mm a')}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
}
