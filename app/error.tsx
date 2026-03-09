"use client"

import { useEffect } from "react"

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    useEffect(() => {
        console.error("[App] Unhandled error:", error)
    }, [error])

    return (
        <html>
            <body>
                <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8 text-center">
                    <p className="text-lg font-semibold text-gray-900">Something went wrong</p>
                    <p className="text-sm text-gray-500 max-w-sm">
                        An unexpected error occurred. Please refresh the page.
                    </p>
                    <button
                        onClick={reset}
                        className="px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:opacity-90 transition-all"
                    >
                        Refresh
                    </button>
                </div>
            </body>
        </html>
    )
}
