"use client";

import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RadioGroup } from "@/components/ui/radio-group";

type Step = "phone" | "registering" | "logging-in";

export default function TesterLoginPage() {
    const [step, setStep] = useState<Step>("phone");
    const [phoneNumber, setPhoneNumber] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    // Registration fields
    const [showRegister, setShowRegister] = useState(false);
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [orgAction, setOrgAction] = useState<"create" | "join">("create");
    const [companyName, setCompanyName] = useState("");
    const [role, setRole] = useState<"key_partner" | "other_partner">("key_partner");
    const [partnerPhone, setPartnerPhone] = useState("");
    const [managerPhone, setManagerPhone] = useState("");

    const [statusMsg, setStatusMsg] = useState("");

    // Check URL params for errors on mount
    React.useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const err = params.get("error");
        if (err) {
            const errorMessages: Record<string, string> = {
                config: "Server configuration error",
                missing_phone: "Phone number is required",
                create_failed: "Failed to create auth user",
                login_failed: "Login failed. Please try again.",
                unknown: "Something went wrong. Please try again.",
            };
            setError(errorMessages[err] || `Error: ${err}`);
            // Clean URL
            window.history.replaceState({}, "", "/huehue");
        }
    }, []);

    const doLogin = (phone10: string) => {
        setStep("logging-in");
        setStatusMsg("Creating session...");
        setError(null);

        // Navigate directly to the API route — it returns a redirect with cookies set
        // This is a full-page navigation, NOT a fetch(), so Set-Cookie headers are applied
        window.location.href = `/api/test-auth?phone=${phone10}`;
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
                // User exists — navigate to test-auth which sets cookies and redirects
                doLogin(digits);
            } else {
                // User doesn't exist — show registration form
                setShowRegister(true);
                setLoading(false);
            }
        } catch (err) {
            console.error(err);
            setError("Something went wrong. Try again.");
            setLoading(false);
        }
    };

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!firstName.trim()) { setError("First name is required."); return; }
        if (!lastName.trim()) { setError("Last name is required."); return; }

        if (orgAction === "create" && !companyName.trim()) {
            setError("Company name is required."); return;
        }

        if (orgAction === "join") {
            if (role === "key_partner" && !partnerPhone.trim()) {
                setError("Partner's phone number is required."); return;
            }
            if (role === "other_partner" && !managerPhone.trim()) {
                setError("Manager's phone number is required."); return;
            }
        }

        setLoading(true);
        setStep("registering");
        setStatusMsg("Creating test user...");

        const digits = phoneNumber.replace(/\D/g, "");

        try {
            const payload: Record<string, string> = {
                phone: digits,
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                action: orgAction,
            };

            if (orgAction === "create") {
                payload.companyName = companyName.trim();
            } else {
                payload.role = role;
                if (role === "key_partner") {
                    payload.partnerPhone = partnerPhone.replace(/\D/g, "");
                } else {
                    payload.managerPhone = managerPhone.replace(/\D/g, "");
                }
            }

            const res = await fetch("/api/test-register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const data = await res.json();

            if (!res.ok) {
                setError(data.error || "Registration failed");
                setStep("phone");
                setLoading(false);
                return;
            }

            if (data.status === "pending_approval") {
                setStatusMsg("Request sent! Waiting for partner approval.");
                setLoading(false);
                return;
            }

            setStatusMsg("User created! Logging in...");
            doLogin(digits);
        } catch (err) {
            console.error(err);
            setError("Registration failed. Try again.");
            setStep("phone");
            setLoading(false);
        }
    };

    // Loading / redirect screen
    if (step === "logging-in" || step === "registering") {
        return (
            <main className="min-h-screen flex items-center justify-center p-4 bg-background">
                <div className="flex flex-col items-center gap-4">
                    {(statusMsg !== "Request sent! Waiting for partner approval.") && (
                        <div className="w-10 h-10 border-4 border-zinc-200 border-t-yellow-500 rounded-full animate-spin" />
                    )}
                    {statusMsg === "Request sent! Waiting for partner approval." && (
                        <div className="text-5xl mb-2">📩</div>
                    )}
                    <p className="text-zinc-500 font-medium text-lg text-center max-w-[80%]">{statusMsg}</p>
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
                        {/* CLS fix: use grid with row transition instead of conditional mount */}
                        <div
                            className="grid transition-all duration-300 ease-out"
                            style={{ gridTemplateRows: showRegister ? '1fr' : '0fr' }}
                        >
                            <div className="overflow-hidden">
                                <div className="space-y-4 p-5 rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/50">
                                    <p className="text-sm font-bold text-amber-700">
                                        📋 This number isn&apos;t registered. Fill in the details below:
                                    </p>

                                    <div className="grid grid-cols-2 gap-4">
                                        <Input
                                            name="tester-first-name"
                                            placeholder="First Name"
                                            value={firstName}
                                            onChange={(e) => setFirstName(e.target.value)}
                                            disabled={loading}
                                        />
                                        <Input
                                            name="tester-last-name"
                                            placeholder="Last Name"
                                            value={lastName}
                                            onChange={(e) => setLastName(e.target.value)}
                                            disabled={loading}
                                        />
                                    </div>

                                    <div className="flex flex-col gap-3 pt-2">
                                        <label className="text-sm font-bold text-black border-t-2 border-amber-200/50 pt-3">
                                            Organisation
                                        </label>
                                        <RadioGroup
                                            name="tester-orgAction"
                                            value={orgAction}
                                            onChange={(val) => {
                                                setOrgAction(val as "create" | "join");
                                                setCompanyName("");
                                                setPartnerPhone("");
                                                setManagerPhone("");
                                                setError(null);
                                            }}
                                            options={[
                                                { value: "create", label: "Create new company" },
                                                { value: "join", label: "Join existing company" },
                                            ]}
                                        />
                                    </div>

                                    {orgAction === "create" && (
                                        <div className="animate-in fade-in slide-in-from-top-4 duration-300 pt-2">
                                            <Input
                                                name="tester-company"
                                                placeholder="Company Name"
                                                value={companyName}
                                                onChange={(e) => setCompanyName(e.target.value)}
                                                disabled={loading}
                                            />
                                        </div>
                                    )}

                                    {orgAction === "join" && (
                                        <div className="animate-in fade-in slide-in-from-top-4 duration-300 flex flex-col gap-4 pt-2">
                                            <div className="flex flex-col gap-3">
                                                <label className="text-sm font-bold text-black">
                                                    Your Role
                                                </label>
                                                <RadioGroup
                                                    name="tester-joinRole"
                                                    value={role}
                                                    onChange={(val) => {
                                                        setRole(val as "key_partner" | "other_partner");
                                                        setPartnerPhone("");
                                                        setManagerPhone("");
                                                        setError(null);
                                                    }}
                                                    options={[
                                                        { value: "key_partner", label: "Key Partner (Owner)" },
                                                        { value: "other_partner", label: "Other Partner (Employee)" },
                                                    ]}
                                                />
                                            </div>

                                            {role === "key_partner" && (
                                                <div className="animate-in fade-in slide-in-from-top-4 duration-300">
                                                    <Input
                                                        placeholder="Partner's Phone Number"
                                                        name="tester-partner-phone"
                                                        value={partnerPhone}
                                                        onChange={(e) => {
                                                            const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                                                            setPartnerPhone(val);
                                                        }}
                                                        disabled={loading}
                                                    />
                                                </div>
                                            )}

                                            {role === "other_partner" && (
                                                <div className="animate-in fade-in slide-in-from-top-4 duration-300">
                                                    <Input
                                                        placeholder="Manager's Phone Number"
                                                        name="tester-manager-phone"
                                                        value={managerPhone}
                                                        onChange={(e) => {
                                                            const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                                                            setManagerPhone(val);
                                                        }}
                                                        disabled={loading}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* CLS fix: reserve space for error message to prevent layout shift */}
                        <p className={`text-sm font-medium text-red-500 min-h-[1.25rem] transition-opacity duration-200 ${error ? 'opacity-100' : 'opacity-0'}`}>
                            {error || '\u00A0'}
                        </p>

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
