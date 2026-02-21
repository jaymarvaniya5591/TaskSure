import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { format, startOfWeek, addDays, startOfDay, endOfDay, isToday, isPast, isFuture } from "date-fns";
import { Clock, Calendar as CalendarIcon, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import TaskTabs from "./task-tabs";

// --- Components ---

function Greeting({ first_name }: { first_name: string }) {
    const hour = new Date().getHours();
    let greeting = "Good evening";
    if (hour < 12) greeting = "Good morning";
    else if (hour < 17) greeting = "Good afternoon";

    return (
        <div className="mb-8 flex items-end justify-between">
            <div>
                <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
                    {greeting}, {first_name}
                </h1>
                <p className="text-gray-500 mt-1">{format(new Date(), "EEEE, d MMMM yyyy")}</p>
            </div>
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

// Status badge and Empty card moved to TaskTabs

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

            <TaskTabs
                todayTasks={todayTasks || []}
                pendingTasks={pendingTasks || []}
                ownedPendingTasks={ownedPendingTasks || []}
            />
        </div>
    );
}
