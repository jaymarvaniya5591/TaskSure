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
 * Client-side auth hook — FAST version.
 *
 * Only calls getSession() (reads from cookie, no network).
 * Returns the raw auth user ID immediately.
 *
 * The profile fetch (name, orgId, phone) has been moved to
 * useDashboardData where it runs IN PARALLEL with task queries
 * instead of as a sequential waterfall step.
 *
 * OLD FLOW (waterfall):
 *   getSession() → profile fetch → THEN dashboard queries
 *   Total: ~1.5s serial before data starts
 *
 * NEW FLOW (parallel):
 *   getSession() → ALL queries start simultaneously (profile + tasks + org)
 *   Total: ~0.5s because everything runs in parallel
 */
export function useAuth(): AuthState {
    const [state, setState] = useState<AuthState>({ user: null, isLoading: true });
    const router = useRouter();

    useEffect(() => {
        let cancelled = false;

        async function resolve() {
            const supabase = createClient();
            const t0 = Date.now();

            // Read session from cookie (local, no network call)
            const { data: { session } } = await supabase.auth.getSession();

            if (!session?.user) {
                debugLog("USE_AUTH", `no session, redirecting to /login (${Date.now() - t0}ms)`);
                router.replace("/login");
                return;
            }

            const authUserId = session.user.id;
            debugLog("USE_AUTH", `session found userId=${authUserId} (${Date.now() - t0}ms)`);

            // Return just the auth userId — profile data is fetched
            // in useDashboardData alongside task queries (parallel, not waterfall)
            if (!cancelled) {
                setState({
                    user: {
                        userId: authUserId,
                        // These will be populated by DashboardClientWrapper
                        // once useDashboardData returns the profile
                        userName: "User",
                        orgId: "",
                        userPhoneNumber: "",
                        reportingManagerId: null,
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
