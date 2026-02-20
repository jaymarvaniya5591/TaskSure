"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
    const router = useRouter();
    const supabase = createClient();
    const [phoneNumber, setPhoneNumber] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        // Basic validation
        const digits = phoneNumber.replace(/\D/g, "");
        if (digits.length !== 10) {
            setError("Please enter a valid 10-digit Indian phone number.");
            return;
        }

        setLoading(true);

        try {
            const fullPhone = `+91${digits}`;
            const { error: signInError } = await supabase.auth.signInWithOtp({
                phone: fullPhone,
            });

            if (signInError) {
                throw signInError;
            }

            // Success, redirect to verify
            router.push(`/login/verify?phone=${encodeURIComponent(fullPhone)}`);
        } catch (err) {
            console.error(err);
            setError(err instanceof Error ? err.message : "Failed to send OTP. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="min-h-screen flex items-center justify-center p-4 bg-background">
            <div className="w-full max-w-md">
                <Card className="border-none shadow-none bg-transparent px-0 sm:px-8">
                    <div className="mb-10">
                        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-black mb-3">
                            Sign in.
                        </h1>
                        <p className="text-lg text-zinc-500 font-medium">
                            Enter your phone number to continue
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="flex flex-col gap-8">
                        <div>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 flex items-center pl-5 pointer-events-none">
                                    <span className="text-black font-bold text-lg">+91</span>
                                </div>
                                <Input
                                    type="tel"
                                    placeholder="98765 43210"
                                    value={phoneNumber}
                                    onChange={(e) => {
                                        const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                                        // Add space after 5 digits for readability if desired, but raw is fine too
                                        setPhoneNumber(val);
                                    }}
                                    className="pl-[4.5rem] text-xl font-bold tracking-wider"
                                    disabled={loading}
                                />
                            </div>
                            {error && <p className="mt-3 text-sm font-medium text-red-500">{error}</p>}
                        </div>

                        <Button type="submit" loading={loading} className="w-full text-lg shadow-[0_4px_20px_0_rgba(234,179,8,0.4)]">
                            Send OTP
                        </Button>
                    </form>
                </Card>
            </div>
        </main>
    );
}
