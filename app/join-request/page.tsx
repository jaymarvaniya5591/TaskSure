"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function JoinRequestContent() {
    const searchParams = useSearchParams();
    const requestId = searchParams.get("id");
    const urlAction = searchParams.get("action");

    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<"accepted" | "rejected" | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        if (!requestId) {
            setError("Invalid join request link.");
        }
        // If action is pre-set in URL, auto-process
        if (requestId && urlAction === "accept") {
            handleAction("accept");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [requestId, urlAction]);

    const handleAction = async (action: "accept" | "reject") => {
        if (!requestId) return;

        setLoading(true);
        setError(null);

        try {
            const res = await fetch("/api/auth/accept-join", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ requestId, action }),
            });

            const data = await res.json();

            if (!res.ok) {
                setError(data.error || "Something went wrong.");
                return;
            }

            setResult(action === "accept" ? "accepted" : "rejected");
        } catch (err) {
            console.error(err);
            setError("Something went wrong. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    if (!requestId) {
        return (
            <Card className="border-none shadow-none bg-transparent px-0 sm:px-8">
                <div className="text-center py-12">
                    <div className="text-5xl mb-6">❌</div>
                    <h1 className="text-3xl font-extrabold text-black mb-3">
                        Invalid Link
                    </h1>
                    <p className="text-lg text-zinc-500 font-medium">
                        This join request link is invalid or has expired.
                    </p>
                </div>
            </Card>
        );
    }

    if (result) {
        return (
            <Card className="border-none shadow-none bg-transparent px-0 sm:px-8">
                <div className="text-center py-12">
                    <div className="text-5xl mb-6">{result === "accepted" ? "✅" : "❌"}</div>
                    <h1 className="text-3xl font-extrabold text-black mb-3">
                        {result === "accepted" ? "Request Approved!" : "Request Rejected"}
                    </h1>
                    <p className="text-lg text-zinc-500 font-medium">
                        {result === "accepted"
                            ? "The user has been added to your company. They will receive a WhatsApp notification."
                            : "The join request has been rejected."}
                    </p>
                </div>
            </Card>
        );
    }

    return (
        <Card className="border-none shadow-none bg-transparent px-0 sm:px-8">
            <div className="mb-10">
                <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-black mb-3">
                    Join Request
                </h1>
                <p className="text-lg text-zinc-500 font-medium">
                    Someone wants to join your company
                </p>
            </div>

            {error && (
                <div className="mb-6">
                    <p className="text-sm font-medium text-red-500">{error}</p>
                </div>
            )}

            <div className="flex flex-col gap-4">
                <Button
                    onClick={() => handleAction("accept")}
                    loading={loading}
                    className="w-full text-lg shadow-[0_4px_20px_0_rgba(234,179,8,0.4)]"
                >
                    ✅ Approve
                </Button>
                <Button
                    onClick={() => handleAction("reject")}
                    loading={loading}
                    variant="secondary"
                    className="w-full text-lg"
                >
                    ❌ Reject
                </Button>
            </div>
        </Card>
    );
}

export default function JoinRequestPage() {
    return (
        <main className="min-h-screen flex items-center justify-center p-4 bg-background">
            <div className="w-full max-w-md">
                <Suspense fallback={<Card className="p-12 border-none shadow-none bg-transparent flex justify-center"><div className="animate-pulse w-10 h-10 rounded-full bg-zinc-200"></div></Card>}>
                    <JoinRequestContent />
                </Suspense>
            </div>
        </main>
    );
}
