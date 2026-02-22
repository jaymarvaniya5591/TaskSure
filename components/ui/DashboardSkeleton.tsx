"use client";

/**
 * DashboardSkeleton — Reusable shimmer skeleton components for instant page shells.
 * 
 * Used by loading.tsx files (Next.js Suspense boundaries) to show instant UI
 * while server components resolve. Also used by client pages while React Query fetches.
 */

import { cn } from "@/lib/utils";

// ─── Base shimmer bar ────────────────────────────────────────────────────────

function Shimmer({ className }: { className?: string }) {
    return (
        <div
            className={cn(
                "animate-pulse rounded-xl bg-gray-200/70",
                className
            )}
        />
    );
}

// ─── Task card skeleton ──────────────────────────────────────────────────────

export function SkeletonCard() {
    return (
        <div className="rounded-2xl border border-gray-100 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="flex-1 space-y-2.5">
                    <Shimmer className="h-4 w-3/4" />
                    <div className="flex items-center gap-2">
                        <Shimmer className="h-3 w-24" />
                        <Shimmer className="h-3 w-20" />
                    </div>
                </div>
                <Shimmer className="h-8 w-8 rounded-xl shrink-0" />
            </div>
        </div>
    );
}

// ─── List of card skeletons ──────────────────────────────────────────────────

export function SkeletonList({ count = 4 }: { count?: number }) {
    return (
        <div className="space-y-3">
            {Array.from({ length: count }).map((_, i) => (
                <SkeletonCard key={i} />
            ))}
        </div>
    );
}

// ─── Calendar strip skeleton ─────────────────────────────────────────────────

export function SkeletonCalendar() {
    return (
        <div className="bg-gray-900 rounded-3xl p-5 sm:p-6 shadow-xl">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                    <Shimmer className="h-8 w-8 rounded-xl bg-gray-700" />
                    <Shimmer className="h-5 w-28 bg-gray-700" />
                </div>
                <Shimmer className="h-6 w-24 rounded-full bg-gray-700" />
            </div>
            <div className="grid grid-cols-7 gap-2 sm:gap-3">
                {Array.from({ length: 7 }).map((_, i) => (
                    <div key={i} className="flex flex-col items-center gap-2 px-1.5 py-2.5 rounded-xl bg-gray-800/40 border border-gray-700/50">
                        <Shimmer className="h-3 w-8 bg-gray-700" />
                        <Shimmer className="h-6 w-6 bg-gray-700 rounded-lg" />
                        <Shimmer className="h-4 w-4 bg-gray-700 rounded-md" />
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── Text lines skeleton ─────────────────────────────────────────────────────

export function SkeletonText({ lines = 3 }: { lines?: number }) {
    return (
        <div className="space-y-2.5">
            {Array.from({ length: lines }).map((_, i) => (
                <Shimmer
                    key={i}
                    className={cn("h-3.5", i === lines - 1 ? "w-2/3" : "w-full")}
                />
            ))}
        </div>
    );
}

// ─── Profile section skeleton ────────────────────────────────────────────────

export function SkeletonProfileSection() {
    return (
        <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-gray-100">
            <div className="flex items-start gap-3 sm:gap-4">
                <Shimmer className="w-10 h-10 sm:w-12 sm:h-12 rounded-full shrink-0" />
                <div className="flex-1 space-y-3">
                    <Shimmer className="h-3 w-20" />
                    <Shimmer className="h-5 w-40" />
                </div>
            </div>
        </div>
    );
}

// ─── Full dashboard shell skeleton (for initial server-side load) ────────────
// This is used by (dashboard)/loading.tsx — the FIRST thing the user sees
// while the server resolves resolveCurrentUser() + layout.tsx

export function DashboardShellSkeleton() {
    return (
        <div className="flex flex-col items-center justify-center h-[60vh] animate-fade-in-up">
            <div className="relative">
                {/* Pulsing logo */}
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-200/50 animate-pulse">
                    <span className="text-2xl font-black text-white">B</span>
                </div>
                {/* Spinning ring around logo */}
                <div className="absolute -inset-2 rounded-2xl border-2 border-amber-300/30 animate-spin" style={{ animationDuration: "3s" }} />
            </div>
            <p className="mt-6 text-sm font-semibold text-gray-400 animate-pulse">Loading workspace...</p>
        </div>
    );
}

// ─── Dashboard home skeleton ─────────────────────────────────────────────────

export function DashboardHomeSkeleton() {
    return (
        <div className="max-w-3xl animate-fade-in-up">
            {/* Greeting */}
            <div className="mb-6">
                <Shimmer className="h-8 w-64 mb-2" />
                <Shimmer className="h-4 w-40" />
            </div>

            {/* Calendar strip */}
            <div className="mb-6">
                <SkeletonCalendar />
            </div>

            {/* Notebook area */}
            <div
                className="relative rounded-3xl p-3 sm:p-4 mb-8 overflow-hidden"
                style={{
                    background: "linear-gradient(135deg, #FFD600 0%, #FFAB00 50%, #FFC107 100%)",
                }}
            >
                <div className="relative z-10 space-y-3 sm:space-y-4">
                    {/* Tab toggle */}
                    <div className="backdrop-blur-xl bg-white/60 border border-white/40 shadow-sm rounded-2xl p-1">
                        <div className="flex">
                            <Shimmer className="flex-1 h-10 rounded-xl bg-white/70" />
                            <Shimmer className="flex-1 h-10 rounded-xl bg-white/30 ml-1" />
                        </div>
                    </div>

                    {/* Content area */}
                    <div className="backdrop-blur-xl bg-white/60 border border-white/40 shadow-sm rounded-2xl p-3 sm:p-5 min-h-[400px]">
                        <div className="flex flex-wrap gap-2 mb-4">
                            <Shimmer className="h-8 w-32 rounded-full bg-white/70" />
                            <Shimmer className="h-8 w-36 rounded-full bg-white/70" />
                            <Shimmer className="h-8 w-24 rounded-full bg-white/70" />
                        </div>
                        <SkeletonList count={3} />
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── All tasks page skeleton ─────────────────────────────────────────────────

export function AllTasksSkeleton() {
    return (
        <div className="max-w-3xl animate-fade-in-up">
            <div className="mb-6">
                <Shimmer className="h-8 w-40 mb-4" />
                <div className="flex bg-gray-100 rounded-xl p-1 mb-4">
                    <Shimmer className="flex-1 h-10 rounded-lg bg-white" />
                    <Shimmer className="flex-1 h-10 rounded-lg bg-transparent ml-1" />
                </div>
            </div>
            <SkeletonList count={5} />
        </div>
    );
}

// ─── Profile page skeleton ───────────────────────────────────────────────────

export function ProfileSkeleton() {
    return (
        <div className="max-w-3xl mx-auto pb-12 animate-fade-in-up">
            <Shimmer className="h-8 w-48 mb-6 sm:mb-8" />
            <div className="space-y-4 sm:space-y-6">
                <SkeletonProfileSection />
                <SkeletonProfileSection />
                <SkeletonProfileSection />
                <SkeletonProfileSection />
            </div>
        </div>
    );
}

// ─── Employee / Team page skeleton ───────────────────────────────────────────

export function EmployeeSkeleton() {
    return (
        <div className="space-y-6 animate-fade-in-up">
            {/* Employee profile card */}
            <div className="bg-white rounded-2xl p-5 sm:p-6 shadow-sm border border-gray-100">
                <div className="flex items-center gap-4">
                    <Shimmer className="w-16 h-16 rounded-full shrink-0" />
                    <div className="flex-1 space-y-2">
                        <Shimmer className="h-6 w-48" />
                        <Shimmer className="h-4 w-32" />
                        <Shimmer className="h-3 w-40" />
                    </div>
                </div>
            </div>

            {/* Performance chart placeholder */}
            <div className="bg-white rounded-2xl p-5 sm:p-6 shadow-sm border border-gray-100">
                <Shimmer className="h-5 w-40 mb-4" />
                <div className="flex items-center justify-center py-8">
                    <Shimmer className="w-32 h-32 rounded-full" />
                </div>
            </div>

            {/* Task list */}
            <div className="bg-white rounded-2xl p-5 sm:p-6 shadow-sm border border-gray-100">
                <Shimmer className="h-5 w-32 mb-4" />
                <SkeletonList count={4} />
            </div>
        </div>
    );
}
