"use client";

import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Step = "phone" | "registering" | "logging-in";

export default function TesterLoginPage() {
    const [step, setStep] = useState<Step>("phone");
    const [phoneNumber, setPhoneNumber] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    // Registration fields
    const [showRegister, setShowRegister] = useState(false);
    const [name, setName] = useState("");
    const [companyName, setCompanyName] = useState("");
    const [reportingManagerId, setReportingManagerId] = useState("");

    const [statusMsg, setStatusMsg] = useState("");

    const doLogin = async (phone10: string) => {
        setStep("logging-in");
        setStatusMsg("Creating session...");
        setError(null);

        try {
            // Call test-auth which creates a session and sets cookies in the response
            const res = await fetch("/api/test-auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phone: `+91${phone10}` }),
                credentials: "same-origin", // ensure cookies from response are stored
            });
            const data = await res.json();

            if (!data.success) {
                setError(data.error || "Login failed");
                setStep("phone");
                return;
            }

            setStatusMsg("Redirecting to dashboard...");
            // Hard navigate — cookies are already set by the API response
            window.location.href = "/home";
        } catch (err) {
            console.error(err);
            setError("Something went wrong. Try again.");
            setStep("phone");
        }
    };

    const handlePhoneSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setShowRegister(false);

        const digits = phoneNumber.replace(/\D/g, "");
        if (digits.length !== 10) {
            setError("Enter a valid 10-digit phone number.");
            return;
        }

        setLoading(true);

        try {
            // Check if user exists
            const res = await fetch("/api/check-phone", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phone: digits }),
            });
            const data = await res.json();

            if (data.exists) {
                // User exists — log them in directly
                await doLogin(digits);
            } else {
                // User doesn't exist — show registration form
                setShowRegister(true);
            }
        } catch (err) {
            console.error(err);
            setError("Something went wrong. Try again.");
        } finally {
            setLoading(false);
        }
    };

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!name.trim()) { setError("Name is required."); return; }
        if (!companyName.trim()) { setError("Company name is required."); return; }

        setLoading(true);
        setStep("registering");
        setStatusMsg("Creating user...");

        const digits = phoneNumber.replace(/\D/g, "");

        try {
            const res = await fetch("/api/test-register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    phone: digits,
                    name: name.trim(),
                    company_name: companyName.trim(),
                    reporting_manager_id: reportingManagerId.trim() || undefined,
                }),
            });
            const data = await res.json();

            if (!res.ok) {
                setError(data.error || "Registration failed");
                setStep("phone");
                setLoading(false);
                return;
            }

            setStatusMsg("User created! Logging in...");
            await doLogin(digits);
        } catch (err) {
            console.error(err);
            setError("Registration failed. Try again.");
            setStep("phone");
        } finally {
            setLoading(false);
        }
    };

    // Loading / redirect screen
    if (step === "logging-in" || step === "registering") {
        return (
            <main className="min-h-screen flex items-center justify-center p-4 bg-background">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-10 h-10 border-4 border-zinc-200 border-t-yellow-500 rounded-full animate-spin" />
                    <p className="text-zinc-500 font-medium text-lg">{statusMsg}</p>
                    {error && (
                        <p className="text-red-500 text-sm font-medium">{error}</p>
                    )}
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen flex items-center justify-center p-4 bg-background">
            <div className="w-full max-w-md">
                <Card className="border-none shadow-none bg-transparent px-0 sm:px-8">
                    <div className="mb-10">
                        <div className="inline-flex items-center gap-2 mb-6">
                            <span className="text-2xl">🧪</span>
                            <span className="text-sm font-bold text-amber-600 bg-amber-50 px-3 py-1 rounded-full border border-amber-200">
                                Tester Access
                            </span>
                        </div>
                        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-black mb-3">
                            Quick Login.
                        </h1>
                        <p className="text-lg text-zinc-500 font-medium">
                            Enter any phone number to access the dashboard
                        </p>
                    </div>

                    {/* Step 1: Phone number */}
                    <form
                        onSubmit={showRegister ? handleRegister : handlePhoneSubmit}
                        autoComplete="off"
                        className="flex flex-col gap-6"
                    >
                        <div>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 flex items-center pl-5 pointer-events-none">
                                    <span className="text-black font-bold text-lg">+91</span>
                                </div>
                                <Input
                                    type="tel"
                                    inputMode="tel"
                                    autoComplete="off"
                                    name="tester-phone-input"
                                    placeholder="98765 43210"
                                    value={phoneNumber}
                                    onChange={(e) => {
                                        const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                                        setPhoneNumber(val);
                                        setError(null);
                                        setShowRegister(false);
                                    }}
                                    className="pl-[4.5rem] text-xl font-bold tracking-wider"
                                    disabled={loading || showRegister}
                                />
                            </div>
                        </div>

                        {/* Registration fields — shown when phone not found */}
                        {showRegister && (
                            <div className="animate-fade-in-up space-y-4 p-5 rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/50">
                                <p className="text-sm font-bold text-amber-700">
                                    📋 This number isn&apos;t registered. Fill in the details below:
                                </p>

                                <Input
                                    name="tester-name"
                                    placeholder="Full Name"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    disabled={loading}
                                />

                                <Input
                                    name="tester-company"
                                    placeholder="Company Name"
                                    value={companyName}
                                    onChange={(e) => setCompanyName(e.target.value)}
                                    disabled={loading}
                                />

                                <Input
                                    name="tester-manager"
                                    placeholder="Reporting Manager ID (optional)"
                                    value={reportingManagerId}
                                    onChange={(e) => setReportingManagerId(e.target.value)}
                                    disabled={loading}
                                />
                            </div>
                        )}

                        {error && <p className="text-sm font-medium text-red-500">{error}</p>}

                        <Button
                            type="submit"
                            loading={loading}
                            className="w-full text-lg shadow-[0_4px_20px_0_rgba(234,179,8,0.4)]"
                        >
                            {showRegister ? "Register & Login →" : "Access Dashboard →"}
                        </Button>

                        {showRegister && (
                            <button
                                type="button"
                                onClick={() => {
                                    setShowRegister(false);
                                    setError(null);
                                }}
                                className="text-sm text-zinc-500 font-medium hover:text-black transition-colors"
                            >
                                ← Try a different number
                            </button>
                        )}
                    </form>

                    <div className="mt-10 text-center">
                        <p className="text-xs text-zinc-400 font-medium">
                            This page is for internal testing only.
                        </p>
                    </div>
                </Card>
            </div>
        </main>
    );
}
