"use client";

import React, { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Link from "next/link";

/**
 * ⚠️ TEMPORARY TEST HARDCODE
 * The WhatsApp bot phone number for wa.me links.
 * See TEMP_AUTH_HARDCODING.md for removal instructions.
 */
const WHATSAPP_BOT_NUMBER = "919620131867";

function SignupContent() {
    const searchParams = useSearchParams();
    const initialPhone = (searchParams.get("phone") || "").replace(/\D/g, "").replace(/^91/, "").slice(0, 10);
    const [phoneNumber, setPhoneNumber] = useState(initialPhone);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [alreadyExists, setAlreadyExists] = useState(false);

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        const digits = phoneNumber.replace(/\D/g, "");
        if (digits.length !== 10) {
            setError("Please enter a valid 10-digit Indian phone number.");
            return;
        }

        setLoading(true);

        try {
            // Check if user already exists
            const checkRes = await fetch('/api/check-phone', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: `+91${digits}` }),
            });
            const checkData = await checkRes.json();

            if (checkData.exists) {
                // User already has an account — switch to sign-in mode
                setAlreadyExists(true);
                setError(null);
                setLoading(false);
                return;
            }

            // User does NOT exist — open WhatsApp with signup message
            const whatsappUrl = `https://wa.me/${WHATSAPP_BOT_NUMBER}?text=${encodeURIComponent("I want to sign up")}`;
            window.open(whatsappUrl, "_blank");
        } catch (err) {
            console.error(err);
            setError("Something went wrong. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const handleSigninRedirect = () => {
        const whatsappUrl = `https://wa.me/${WHATSAPP_BOT_NUMBER}?text=${encodeURIComponent("Sign in")}`;
        window.open(whatsappUrl, "_blank");
    };

    const loginHref = phoneNumber ? `/login?phone=${encodeURIComponent(phoneNumber)}` : "/login";

    return (
        <Card className="border-none shadow-none bg-transparent px-0 sm:px-8">
            <div className="mb-10">
                <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-black mb-3">
                    Get Started.
                </h1>
                <p className="text-lg text-zinc-500 font-medium">
                    Enter your phone number to begin
                </p>
            </div>

            <form onSubmit={handleVerify} autoComplete="off" className="flex flex-col gap-8">
                <div>
                    <div className="relative">
                        <div className="absolute inset-y-0 left-0 flex items-center pl-5 pointer-events-none">
                            <span className="text-black font-bold text-lg">+91</span>
                        </div>
                        <Input
                            type="tel"
                            inputMode="tel"
                            autoComplete="off"
                            name="signup-phone-input"
                            placeholder="98765 43210"
                            value={phoneNumber}
                            onChange={(e) => {
                                const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                                setPhoneNumber(val);
                                setError(null);
                                setAlreadyExists(false);
                            }}
                            className="pl-[4.5rem] text-xl font-bold tracking-wider"
                        />
                    </div>
                    {error && <p className="mt-3 text-sm font-medium text-red-500">{error}</p>}
                    {alreadyExists && (
                        <p className="mt-3 text-sm font-medium text-amber-600">
                            You already have an account! Click below to sign in instead.
                        </p>
                    )}
                </div>

                {alreadyExists ? (
                    <Button
                        type="button"
                        onClick={handleSigninRedirect}
                        className="w-full text-lg shadow-[0_4px_20px_0_rgba(234,179,8,0.4)]"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="mr-2">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                        </svg>
                        Sign in via WhatsApp
                    </Button>
                ) : (
                    <Button
                        type="submit"
                        disabled={loading}
                        className="w-full text-lg shadow-[0_4px_20px_0_rgba(234,179,8,0.4)]"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="mr-2">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                        </svg>
                        {loading ? "Checking..." : "Verify via WhatsApp"}
                    </Button>
                )}

                <div className="bg-zinc-50 rounded-2xl p-5 border border-zinc-100">
                    <p className="text-sm text-zinc-500 font-medium leading-relaxed">
                        <span className="font-bold text-zinc-700">How it works:</span>{" "}
                        Clicking &quot;Verify via WhatsApp&quot; opens WhatsApp where you&apos;ll send us a message.
                        Once we receive it, you&apos;ll get a signup link to complete your registration.
                    </p>
                </div>
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
