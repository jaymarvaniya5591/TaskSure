"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
    Home,
    CheckSquare,
    Send,
    ListTodo,
    CalendarDays,
    Users,
    BarChart2,
    Settings,
} from "lucide-react";

const navigation = [
    { name: "Home", href: "/home", icon: Home },
    { name: "My Tasks", href: "/my-tasks", icon: CheckSquare },
    { name: "Assigned Tasks", href: "/assigned-tasks", icon: Send },
    { name: "Todos", href: "/todos", icon: ListTodo },
    { name: "Calendar", href: "/calendar", icon: CalendarDays },
    { name: "Team", href: "/team", icon: Users },
    { name: "Stats", href: "/stats", icon: BarChart2 },
    { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
    const pathname = usePathname();

    return (
        <div className="hidden lg:flex lg:w-72 lg:flex-col lg:fixed lg:inset-y-0 z-50">
            <div className="flex flex-col flex-grow bg-white border-r border-gray-100 px-6 pb-4 overflow-y-auto">
                <div className="flex h-20 shrink-0 items-center">
                    {/* Logo Placeholder */}
                    <div className="flex items-center gap-2 font-bold text-2xl tracking-tight text-foreground">
                        <div className="w-8 h-8 rounded-lg bg-accent-500 flex items-center justify-center text-white">
                            <span className="text-xl">B</span>
                        </div>
                        Boldo AI
                    </div>
                </div>
                <nav className="flex flex-col flex-1 mt-6">
                    <ul role="list" className="flex flex-col flex-1 gap-y-7">
                        <li>
                            <ul role="list" className="-mx-2 space-y-2">
                                {navigation.map((item) => {
                                    const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                                    return (
                                        <li key={item.name}>
                                            <Link
                                                href={item.href}
                                                className={cn(
                                                    isActive
                                                        ? "bg-accent-50 text-accent-900"
                                                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-50",
                                                    "group flex gap-x-3 rounded-2xl p-3 text-sm leading-6 font-semibold transition-all duration-200"
                                                )}
                                            >
                                                <item.icon
                                                    className={cn(
                                                        isActive ? "text-accent-600" : "text-gray-400 group-hover:text-gray-600",
                                                        "h-5 w-5 shrink-0 transition-colors"
                                                    )}
                                                    aria-hidden="true"
                                                />
                                                {item.name}
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ul>
                        </li>
                    </ul>
                </nav>
            </div>
        </div>
    );
}
