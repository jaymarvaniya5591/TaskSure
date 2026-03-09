"use client"

import { useEffect } from "react"

export default function DashboardError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    useEffect(() => {
        console.error("[Dashboard] Unhandled error:", error)
    }, [error])

    return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8 text-center">
            <p className="text-lg font-semibold text-gray-900">Something went wrong</p>
            <p className="text-sm text-gray-500 max-w-sm">
                An unexpected error occurred. Please try refreshing the page.
            </p>
            <button
                onClick={reset}
                className="px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:opacity-90 transition-all"
            >
                Try again
            </button>
        </div>
    )
}
