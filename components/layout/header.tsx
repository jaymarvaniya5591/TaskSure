"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Menu } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { useSidebar } from "@/components/layout/SidebarProvider";
import { useUserContext } from "@/lib/user-context";
import SearchEmployee from "@/components/dashboard/SearchEmployee";

interface UserProfile {
    name: string;
    organisation: { name: string } | null;
}

export function Header() {
    const { toggleMobileSidebar } = useSidebar();
    const { orgUsers, userId, userName } = useUserContext();
    const [supabase] = useState(() => createClient());
    const [profile, setProfile] = useState<UserProfile | null>(null);

    useEffect(() => {
        async function loadProfile() {
            // We use the already-resolved userId from the Dashboard context
            // to fetch the specific user/organisation details directly.
            const { data } = await supabase
                .from('users')
                .select('name, organisation:organisations(name)')
                .eq('id', userId)
                .single();

            if (data) {
                setProfile({
                    name: data.name,
                    organisation: Array.isArray(data.organisation)
                        ? data.organisation[0] || null
                        : data.organisation,
                });
            }
        }

        if (userId) {
            loadProfile();
        }


    }, [supabase, userId]);

    const displayName = profile?.name || userName || "Loading...";
    const initials = displayName
        ? displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
        : "..";

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
                    {/* WhatsApp */}
                    <a
                        href="https://wa.me/919620131867"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="-m-2.5 p-2.5 text-[#25D366] hover:text-green-600 relative transition-colors"
                        title="Contact us on WhatsApp"
                    >
                        <span className="sr-only">Contact us on WhatsApp</span>
                        <FaWhatsapp className="h-6 w-6" aria-hidden="true" />
                    </a>
                </div>
            </div>
        </div>
    );
}
