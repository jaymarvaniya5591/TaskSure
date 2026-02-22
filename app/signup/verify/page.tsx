"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { OtpInput } from "@/components/ui/otp-input";
import { Button } from "@/components/ui/button";
import Link from "next/link";

function SignupVerifyContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const supabase = createClient();

    const phone = searchParams.get("phone");

    const [otp, setOtp] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [alreadyExists, setAlreadyExists] = useState(false);

    useEffect(() => {
        if (!phone) {
            router.replace("/signup");
        }
    }, [phone, router]);

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!phone) return;

        if (otp.length !== 6) {
            setError("Please enter all 6 digits.");
            return;
        }

        setError(null);
        setAlreadyExists(false);
        setLoading(true);

        try {
            // Test OTP bypass
            if (otp === '123456') {
                const testLoginSuccess = await attemptTestLogin(phone);
                if (testLoginSuccess) return;
                // If it fails, let it fall through or throw
            }

            // Standard OTP verification
            const { data, error: verifyError } = await supabase.auth.verifyOtp({
                phone,
                token: otp,
                type: 'sms',
            });

            if (verifyError) throw verifyError;

            if (data.user) {
                // Check if user already has a profile
                const { data: profile } = await supabase
                    .from('users')
                    .select('id')
                    .eq('phone_number', phone)
                    .single();

                if (profile) {
                    // User already exists — they should sign in, not sign up
                    setAlreadyExists(true);
                    setError("This phone number is already registered. Please sign in instead.");
                } else {
                    // New user — proceed to profile completion
                    router.push(`/signup/profile?phone=${encodeURIComponent(phone)}`);
                }
            } else {
                throw new Error("Verification failed. Please try again.");
            }
        } catch (err) {
            console.error(err);
            setError(err instanceof Error ? err.message : "Invalid or expired OTP. Please try again.");
            setOtp("");
        } finally {
            setLoading(false);
        }
    };

    // Fallback login for test users (when no SMS provider is configured)
    const attemptTestLogin = async (phoneNumber: string): Promise<boolean> => {
        try {
            // Step 1: Get test session from our custom test-auth API
            const res = await fetch('/api/test-auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: phoneNumber }),
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || "Failed test auth");
            }

            const { access_token, refresh_token } = await res.json();

            // Step 2: Set the session locally
            const { error: sessionError } = await supabase.auth.setSession({
                access_token,
                refresh_token,
            });

            if (sessionError) return false;

            // Step 3: Check for user profile
            const { data: profile } = await supabase
                .from('users')
                .select('id')
                .eq('phone_number', phoneNumber)
                .single();

            if (profile) {
                // User already exists — they should sign in, not sign up
                setAlreadyExists(true);
                setError("This phone number is already registered. Please sign in instead.");
                return true;
            } else {
                // New user — proceed to profile completion
                router.push(`/signup/profile?phone=${encodeURIComponent(phoneNumber)}`);
                return true;
            }
        } catch (error) {
            console.error("Test login failed:", error);
            return false; // Fallback failed, block progression
        }
    };

    const handleBack = () => {
        router.back();
    };

    if (!phone) return null;

    return (
        <Card className="border-none shadow-none bg-transparent px-4 sm:px-8">
            <div className="mb-8">
                <button
                    onClick={handleBack}
                    className="text-base font-bold text-zinc-400 hover:text-black transition-colors flex items-center gap-1.5"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
                    Back
                </button>
            </div>

            <div className="mb-10">
                <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-black mb-3">
                    Verify account.
                </h1>
                <p className="text-lg text-zinc-500 font-medium">
                    Enter the 6-digit code sent to <br />
                    <span className="font-extrabold text-black">{phone}</span>
                </p>
            </div>

            <form onSubmit={handleVerify} autoComplete="off" className="flex flex-col gap-10">
                <OtpInput
                    length={6}
                    value={otp}
                    onChange={(val) => {
                        setOtp(val);
                        setError(null);
                        setAlreadyExists(false);
                    }}
                    disabled={loading}
                    error={error || undefined}
                />

                {alreadyExists ? (
                    <div className="flex flex-col gap-4">
                        <Link href="/login">
                            <Button type="button" className="w-full text-lg shadow-[0_4px_20px_0_rgba(234,179,8,0.4)]">
                                Sign In Instead
                            </Button>
                        </Link>
                    </div>
                ) : (
                    <Button type="submit" loading={loading} className="w-full text-lg shadow-[0_4px_20px_0_rgba(234,179,8,0.4)]">
                        Verify & Continue
                    </Button>
                )}
            </form>
        </Card>
    );
}

export default function SignupVerifyPage() {
    return (
        <main className="min-h-screen flex items-center justify-center p-4 bg-background">
            <div className="w-full max-w-md">
                <Suspense fallback={<Card className="p-12 border-none shadow-none bg-transparent flex justify-center"><div className="animate-pulse w-10 h-10 rounded-full bg-zinc-200"></div></Card>}>
                    <SignupVerifyContent />
                </Suspense>
            </div>
        </main>
    );
}
