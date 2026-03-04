"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { debugLog } from "@/lib/debug-logger";

export interface AuthUser {
    userId: string;
    userName: string;
    orgId: string;
    userPhoneNumber: string;
    reportingManagerId: string | null;
}

interface AuthState {
    user: AuthUser | null;
    isLoading: boolean;
}

/**
 * Client-side auth hook.
 *
 * 1. Reads the session from the browser cookie via getSession() — no network call.
 * 2. Fetches the user profile row from the `users` table for name/org/phone.
 * 3. Redirects to /login if no session is found.
 *
 * This replaces the old server-side approach where the dashboard layout
 * called getUser() + RPC to resolve the current user.
 */
export function useAuth(): AuthState {
    const [state, setState] = useState<AuthState>({ user: null, isLoading: true });
    const router = useRouter();

    useEffect(() => {
        let cancelled = false;

        async function resolve() {
            const supabase = createClient();
            const t0 = Date.now();

            // 1. Read session from cookie (local, no network call)
            const { data: { session } } = await supabase.auth.getSession();

            if (!session?.user) {
                debugLog("USE_AUTH", `no session, redirecting to /login (${Date.now() - t0}ms)`);
                router.replace("/login");
                return;
            }

            const authUserId = session.user.id;
            debugLog("USE_AUTH", `session found userId=${authUserId} (${Date.now() - t0}ms)`);

            // 2. Fetch user profile row for name, org, phone, etc.
            const { data: profile, error } = await supabase
                .from("users")
                .select("id, name, phone_number, organisation_id, reporting_manager_id")
                .eq("id", authUserId)
                .single();

            if (error || !profile) {
                debugLog("USE_AUTH", `profile fetch failed: ${error?.message ?? "no data"}`);
                router.replace("/login");
                return;
            }

            if (!cancelled) {
                debugLog("USE_AUTH", `resolved profile in ${Date.now() - t0}ms`);
                setState({
                    user: {
                        userId: profile.id,
                        userName: profile.name || "User",
                        orgId: profile.organisation_id,
                        userPhoneNumber: profile.phone_number || "",
                        reportingManagerId: profile.reporting_manager_id,
                    },
                    isLoading: false,
                });
            }
        }

        resolve();
        return () => { cancelled = true; };
    }, [router]);

    return state;
}
