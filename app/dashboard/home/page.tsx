"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export default function DashboardHomePage() {
    const router = useRouter();
    const supabase = createClient();
    const [userName, setUserName] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function loadUser() {
            try {
                const { data: { user } } = await supabase.auth.getUser();

                if (user?.phone) {
                    // Fetch the full profile from our users table
                    const { data: profile } = await supabase
                        .from('users')
                        .select('name')
                        .eq('phone_number', user.phone)
                        .single();

                    if (profile) {
                        setUserName(profile.name);
                    } else {
                        setUserName(user.phone);
                    }
                }
            } catch (error) {
                console.error("Error loading user", error);
            } finally {
                setLoading(false);
            }
        }

        loadUser();
    }, [supabase]);

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        router.push("/login");
    };

    if (loading) {
        return (
            <main className="min-h-screen p-8 bg-stone-50 flex items-center justify-center">
                <div className="animate-pulse flex items-center gap-2 text-stone-500 font-medium">
                    <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    Loading your dashboard...
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen p-4 sm:p-8 bg-background">
            <div className="max-w-4xl mx-auto">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-10 gap-6">
                    <div>
                        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-black">
                            Welcome back{userName ? `, ${userName}` : "."}
                        </h1>
                        <p className="text-lg text-zinc-500 font-medium mt-2">
                            Here is your Boldo AI dashboard
                        </p>
                    </div>

                    <Button variant="secondary" onClick={handleSignOut} className="min-w-[120px] shadow-[0_4px_14px_0_rgba(234,179,8,0.3)]">
                        Sign out
                    </Button>
                </div>

                <div className="rounded-[32px] border-2 border-zinc-100 bg-white p-12 text-center text-zinc-500 font-medium shadow-sm">
                    Placeholder for actual dashboard content.
                </div>
            </div>
        </main>
    );
}
