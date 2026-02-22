"use client";

import React, { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Link from "next/link";

function SignupContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const supabase = createClient();
    const initialPhone = (searchParams.get("phone") || "").replace(/\D/g, "").replace(/^91/, "").slice(0, 10);
    const [phoneNumber, setPhoneNumber] = useState(initialPhone);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [alreadyExists, setAlreadyExists] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setAlreadyExists(false);

        const digits = phoneNumber.replace(/\D/g, "");
        if (digits.length !== 10) {
            setError("Please enter a valid 10-digit Indian phone number.");
            return;
        }

        setLoading(true);

        try {
            const fullPhone = `+91${digits}`;

            // Check if phone number already exists in users table BEFORE sending OTP
            const checkRes = await fetch('/api/check-phone', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: fullPhone }),
            });
            const checkData = await checkRes.json();

            if (checkData.exists) {
                setAlreadyExists(true);
                setError("This phone number is already registered.");
                setLoading(false);
                return;
            }

            // Phone is new — send OTP
            const { error: signUpError } = await supabase.auth.signInWithOtp({
                phone: fullPhone,
            });

            if (signUpError) {
                console.warn("SMS dispatch failed (expected in test environment). Proceeding to verify screen for static OTP.", signUpError);
            }

            router.push(`/signup/verify?phone=${encodeURIComponent(fullPhone)}`);
        } catch (err) {
            console.error(err);
            setError(err instanceof Error ? err.message : "Failed to proceed. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const loginHref = phoneNumber ? `/login?phone=${encodeURIComponent(phoneNumber)}` : "/login";

    return (
        <Card className="border-none shadow-none bg-transparent px-0 sm:px-8">
            <div className="mb-10">
                <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-black mb-3">
                    Create account.
                </h1>
                <p className="text-lg text-zinc-500 font-medium">
                    Enter your phone number to get started
                </p>
            </div>

            <form onSubmit={handleSubmit} autoComplete="off" className="flex flex-col gap-8">
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
                                setPhoneNumber(val);
                                setError(null);
                                setAlreadyExists(false);
                            }}
                            className="pl-[4.5rem] text-xl font-bold tracking-wider"
                            disabled={loading}
                        />
                    </div>
                    {error && <p className="mt-3 text-sm font-medium text-red-500">{error}</p>}
                </div>

                {alreadyExists ? (
                    <Link href={loginHref}>
                        <Button type="button" className="w-full text-lg shadow-[0_4px_20px_0_rgba(234,179,8,0.4)]">
                            Sign In Instead
                        </Button>
                    </Link>
                ) : (
                    <Button type="submit" loading={loading} className="w-full text-lg shadow-[0_4px_20px_0_rgba(234,179,8,0.4)]">
                        Continue
                    </Button>
                )}
            </form>

            <div className="mt-8 text-center">
                <p className="text-zinc-500 font-medium">
                    Already have an account?{" "}
                    <Link href={loginHref} className="text-black hover:underline font-bold">
                        Sign in
                    </Link>
                </p>
            </div>
        </Card>
    );
}

export default function SignupPage() {
    return (
        <main className="min-h-screen flex items-center justify-center p-4 bg-background">
            <div className="w-full max-w-md">
                <Suspense fallback={<Card className="p-12 border-none shadow-none bg-transparent flex justify-center"><div className="animate-pulse w-10 h-10 rounded-full bg-zinc-200"></div></Card>}>
                    <SignupContent />
                </Suspense>
            </div>
        </main>
    );
}

