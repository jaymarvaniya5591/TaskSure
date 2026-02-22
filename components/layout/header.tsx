"use client";


import { Menu } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { useSidebar } from "@/components/layout/SidebarProvider";
import { useUserContext } from "@/lib/user-context";
import SearchEmployee from "@/components/dashboard/SearchEmployee";


export function Header() {
    const { toggleMobileSidebar } = useSidebar();
    const { orgUsers, userId } = useUserContext();

    return (
        <div className="sticky top-0 z-40 flex h-16 sm:h-20 shrink-0 items-center border-b border-gray-100 bg-white/70 shadow-sm backdrop-blur-lg px-3 sm:px-4 lg:px-8 gap-3 sm:gap-4">
            {/* Hamburger Menu (Mobile Only) */}
            <button
                type="button"
                className="p-2 text-gray-700 lg:hidden shrink-0"
                onClick={toggleMobileSidebar}
            >
                <span className="sr-only">Open sidebar</span>
                <Menu className="h-6 w-6" aria-hidden="true" />
            </button>

            {/* Global Search Employee — fills all remaining space */}
            <div className="flex-1 min-w-0">
                <SearchEmployee orgUsers={orgUsers} currentUserId={userId} isHeader />
            </div>

            {/* WhatsApp — symmetric padding to hamburger */}
            <a
                href="https://wa.me/919620131867"
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 text-[#25D366] hover:text-green-600 transition-colors shrink-0"
                title="Contact us on WhatsApp"
            >
                <span className="sr-only">Contact us on WhatsApp</span>
                <FaWhatsapp className="h-6 w-6" aria-hidden="true" />
            </a>
        </div>
    );
}
