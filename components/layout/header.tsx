"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Bell, LogOut, Menu } from "lucide-react";
import { useSidebar } from "@/components/layout/SidebarProvider";
import { useUserContext } from "@/lib/user-context";
import SearchEmployee from "@/components/dashboard/SearchEmployee";

interface UserProfile {
    name: string;
    organisation: { name: string } | null;
}

export function Header() {
    const router = useRouter();
    const { toggleMobileSidebar } = useSidebar();
    const { orgUsers, userId } = useUserContext();
    const [supabase] = useState(() => createClient());
    const [profile, setProfile] = useState<UserProfile | null>(null);

    useEffect(() => {
        async function loadProfile() {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            // Build phone candidates — handle both real phone auth and test email auth
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

            // Try id-based lookup first
            let data = null;
            const { data: byId } = await supabase
                .from('users')
                .select('name, organisation:organisations(name)')
                .eq('id', user.id)
                .single();

            if (byId) {
                data = byId;
            } else {
                // Try phone candidates
                for (const phone of phoneCandidates) {
                    const { data: byPhone } = await supabase
                        .from('users')
                        .select('name, organisation:organisations(name)')
                        .eq('phone_number', phone)
                        .single();
                    if (byPhone) {
                        data = byPhone;
                        break;
                    }
                }
            }

            if (data) {
                setProfile({
                    name: data.name,
                    organisation: Array.isArray(data.organisation)
                        ? data.organisation[0] || null
                        : data.organisation,
                });
            }
        }

        loadProfile();
    }, [supabase]);

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        router.push("/login");
    };

    const initials = profile?.name
        ? profile.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
        : "..";

    const displayName = profile?.name || "Loading...";
    const orgName = profile?.organisation?.name || "";

    return (
        <div className="sticky top-0 z-40 flex h-20 shrink-0 items-center gap-x-6 border-b border-gray-100 bg-white/70 px-4 shadow-sm sm:px-6 lg:px-8 backdrop-blur-lg">
            {/* Hamburger Menu (Mobile Only) */}
            <button
                type="button"
                className="-m-2.5 p-2.5 text-gray-700 lg:hidden"
                onClick={toggleMobileSidebar}
            >
                <span className="sr-only">Open sidebar</span>
                <Menu className="h-6 w-6" aria-hidden="true" />
            </button>

            {/* Global Search Employee */}
            <div className="flex-1 min-w-0 max-w-md mx-2 sm:mx-0">
                <SearchEmployee orgUsers={orgUsers} currentUserId={userId} isHeader />
            </div>

            <div className="flex shrink-0 gap-x-2 sm:gap-x-4 self-stretch lg:gap-x-6 justify-end items-center">
                <div className="flex items-center gap-x-2 sm:gap-x-4 lg:gap-x-6">
                    {/* Notifications */}
                    <button
                        type="button"
                        className="-m-2.5 p-2.5 text-gray-500 hover:text-gray-900 relative transition-colors"
                    >
                        <span className="sr-only">View notifications</span>
                        <Bell className="h-6 w-6" aria-hidden="true" />
                        <span className="absolute top-2 right-2.5 block h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
                    </button>

                    {/* Separator */}
                    <div
                        className="hidden lg:block lg:h-6 lg:w-px lg:bg-gray-200"
                        aria-hidden="true"
                    />

                    {/* Profile */}
                    <div className="flex items-center gap-x-4 py-3">
                        <span className="sr-only">Your profile</span>
                        <div className="h-9 w-9 rounded-full bg-accent-100 flex items-center justify-center text-accent-700 font-bold text-sm">
                            {initials}
                        </div>
                        <span className="hidden lg:flex lg:flex-col lg:items-start">
                            <span
                                className="text-sm font-semibold leading-5 text-gray-900"
                                aria-hidden="true"
                            >
                                {displayName}
                            </span>
                            {orgName && (
                                <span className="text-xs font-medium leading-4 text-gray-500">
                                    {orgName}
                                </span>
                            )}
                        </span>
                    </div>

                    {/* Sign Out */}
                    <button
                        onClick={handleSignOut}
                        className="-m-2.5 p-2.5 text-gray-400 hover:text-red-600 transition-colors"
                        title="Sign out"
                    >
                        <LogOut className="h-5 w-5" aria-hidden="true" />
                    </button>
                </div>
            </div>
        </div>
    );
}
