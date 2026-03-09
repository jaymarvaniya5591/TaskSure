"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RadioGroup } from "@/components/ui/radio-group";

function SignupCompleteContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const supabase = createClient();

    const token = searchParams.get("token");

    const [phone, setPhone] = useState<string | null>(null);
    const [tokenValid, setTokenValid] = useState<boolean | null>(null);
    const [tokenError, setTokenError] = useState<string | null>(null);

    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [orgAction, setOrgAction] = useState<"create" | "join">("create");
    const [companyName, setCompanyName] = useState("");
    const [role, setRole] = useState<"key_partner" | "other_partner">("key_partner");
    const [partnerPhone, setPartnerPhone] = useState("");
    const [managerPhone, setManagerPhone] = useState("");

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pendingMessage, setPendingMessage] = useState<string | null>(null);

    // Hydrate form from localStorage on mount
    useEffect(() => {
        const _firstName = localStorage.getItem("signup-firstName");
        const _lastName = localStorage.getItem("signup-lastName");
        const _orgAction = localStorage.getItem("signup-orgAction");
        const _companyName = localStorage.getItem("signup-companyName");
        const _role = localStorage.getItem("signup-role");
        const _partnerPhone = localStorage.getItem("signup-partnerPhone");
        const _managerPhone = localStorage.getItem("signup-managerPhone");

        if (_firstName) setFirstName(_firstName);
        if (_lastName) setLastName(_lastName);
        if (_orgAction === "create" || _orgAction === "join") setOrgAction(_orgAction);
        if (_companyName) setCompanyName(_companyName);
        if (_role === "key_partner" || _role === "other_partner") setRole(_role);
        if (_partnerPhone) setPartnerPhone(_partnerPhone);
        if (_managerPhone) setManagerPhone(_managerPhone);
    }, []);

    // Verify token on mount
    useEffect(() => {
        if (!token) {
            setTokenValid(false);
            setTokenError("No signup token found. Please go back and request a new signup link.");
            return;
        }

        // Validate token by calling the verify-link API with a HEAD-like check
        // We'll directly validate via the complete-signup API when submitting.
        // For now, just set token as valid (the API will validate on submit)
        setTokenValid(true);

        // Extract phone from token by calling a lightweight check
        const validateToken = async () => {
            try {
                const res = await fetch(`/api/auth/validate-token?token=${encodeURIComponent(token)}`);
                const data = await res.json();

                if (data.valid && data.phone) {
                    setPhone(data.phone);
                    setTokenValid(true);
                } else {
                    setTokenValid(false);
                    setTokenError(data.error || "This link has expired or is invalid. Please request a new one.");
                }
            } catch {
                // If validate-token doesn't exist yet, accept the token
                setTokenValid(true);
            }
        };

        validateToken();
    }, [token]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!token) return;

        // Validation
        if (!firstName.trim()) {
            setError("Please enter your first name.");
            return;
        }
        if (!lastName.trim()) {
            setError("Please enter your last name.");
            return;
        }

        if (orgAction === "create" && !companyName.trim()) {
            setError("Please enter your company name.");
            return;
        }

        if (orgAction === "join") {
            if (role === "key_partner" && !partnerPhone.trim()) {
                setError("Please enter your partner's phone number.");
                return;
            }
            if (role === "other_partner" && !managerPhone.trim()) {
                setError("Please enter your manager's phone number.");
                return;
            }
        }

        setError(null);
        setLoading(true);
        setPendingMessage(null);

        try {
            const payload: Record<string, string> = {
                token,
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                action: orgAction,
            };

            if (orgAction === "create") {
                payload.companyName = companyName.trim();
            } else {
                payload.role = role;
                if (role === "key_partner") {
                    const digits = partnerPhone.replace(/\D/g, "");
                    payload.partnerPhone = digits.length === 10 ? `+91${digits}` : partnerPhone;
                } else {
                    const digits = managerPhone.replace(/\D/g, "");
                    payload.managerPhone = digits.length === 10 ? `+91${digits}` : managerPhone;
                }
            }

            const res = await fetch("/api/auth/complete-signup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const data = await res.json();

            if (!res.ok) {
                setError(data.error || "Something went wrong. Please try again.");
                return;
            }

            if (data.status === "pending_approval") {
                setPendingMessage(data.message);

                // Form properly submitted and pending: flush stored local user input
                const keysToRemove = [
                    "signup-firstName", "signup-lastName", "signup-orgAction",
                    "signup-companyName", "signup-role", "signup-partnerPhone", "signup-managerPhone"
                ];
                keysToRemove.forEach(k => localStorage.removeItem(k));

                return;
            }

            // Account created but session couldn't be generated server-side
            if (data.status === 'created_no_session') {
                const keysToRemove = [
                    "signup-firstName", "signup-lastName", "signup-orgAction",
                    "signup-companyName", "signup-role", "signup-partnerPhone", "signup-managerPhone"
                ];
                keysToRemove.forEach(k => localStorage.removeItem(k));
                window.location.href = '/login?signup=success';
                return;
            }

            if (data.access_token && data.refresh_token) {
                // Form completely finished: flush stored local user input
                const keysToRemove = [
                    "signup-firstName", "signup-lastName", "signup-orgAction",
                    "signup-companyName", "signup-role", "signup-partnerPhone", "signup-managerPhone"
                ];
                keysToRemove.forEach(k => localStorage.removeItem(k));

                // Set session
                const { error: sessionErr } = await supabase.auth.setSession({
                    access_token: data.access_token,
                    refresh_token: data.refresh_token,
                });

                if (sessionErr) {
                    console.error("[SignupComplete] Session error:", sessionErr);
                    // Account exists, just can't set session — redirect to login
                    window.location.href = '/login?signup=success';
                    return;
                }

                // Hard navigate to dashboard
                window.location.href = "/home";
            }
        } catch (err) {
            console.error(err);
            setError("Something went wrong. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    // Error state — invalid token
    if (tokenValid === false) {
        return (
            <Card className="border-none shadow-none bg-transparent px-0 sm:px-8">
                <div className="text-center py-12">
                    <div className="text-5xl mb-6">⏰</div>
                    <h1 className="text-3xl font-extrabold text-black mb-3">
                        Link Expired
                    </h1>
                    <p className="text-lg text-zinc-500 font-medium mb-8">
                        {tokenError}
                    </p>
                    <Button
                        onClick={() => router.push("/signup")}
                        className="text-lg shadow-[0_4px_20px_0_rgba(234,179,8,0.4)]"
                    >
                        Go to Sign Up
                    </Button>
                </div>
            </Card>
        );
    }

    // Pending approval state
    if (pendingMessage) {
        return (
            <Card className="border-none shadow-none bg-transparent px-0 sm:px-8">
                <div className="text-center py-12">
                    <div className="text-5xl mb-6">📩</div>
                    <h1 className="text-3xl font-extrabold text-black mb-3">
                        Request Sent!
                    </h1>
                    <p className="text-lg text-zinc-500 font-medium mb-4 leading-relaxed">
                        {pendingMessage}
                    </p>
                    <div className="bg-zinc-50 rounded-2xl p-5 border border-zinc-100 mt-6">
                        <p className="text-sm text-zinc-500 font-medium">
                            You can close this page. We&apos;ll send you a WhatsApp message
                            once your partner approves your request.
                        </p>
                    </div>
                </div>
            </Card>
        );
    }

    // Loading state
    if (tokenValid === null) {
        return (
            <div className="flex justify-center py-12">
                <div className="w-10 h-10 border-4 border-zinc-200 border-t-yellow-500 rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <Card className="border-none shadow-none bg-transparent px-0 sm:px-8">
            <div className="mb-10">
                <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-black mb-3">
                    Complete Profile.
                </h1>
                <p className="text-lg text-zinc-500 font-medium">
                    Set up your account to get started
                </p>
                {phone && (
                    <div className="mt-4 bg-zinc-50 rounded-xl px-4 py-3 border border-zinc-100">
                        <p className="text-sm text-zinc-500 font-medium">
                            Verified number:{" "}
                            <span className="font-bold text-black">{phone}</span>
                        </p>
                    </div>
                )}
            </div>

            <form onSubmit={handleSubmit} autoComplete="off" className="flex flex-col gap-7">
                {/* Name inputs */}
                <div className="grid grid-cols-2 gap-4">
                    <Input
                        label="First Name"
                        placeholder="e.g. Ramesh"
                        name="signup-first-name"
                        autoComplete="off"
                        value={firstName}
                        onChange={(e) => { setFirstName(e.target.value.slice(0, 50)); localStorage.setItem("signup-firstName", e.target.value.slice(0, 50)); }}
                        disabled={loading}
                        maxLength={50}
                        required
                    />
                    <Input
                        label="Last Name"
                        placeholder="e.g. Patel"
                        name="signup-last-name"
                        autoComplete="off"
                        value={lastName}
                        onChange={(e) => { setLastName(e.target.value.slice(0, 50)); localStorage.setItem("signup-lastName", e.target.value.slice(0, 50)); }}
                        disabled={loading}
                        maxLength={50}
                        required
                    />
                </div>

                {/* Organisation action */}
                <div className="flex flex-col gap-3 pt-4 border-t-2 border-zinc-100">
                    <label className="text-lg font-bold text-black mb-1">
                        Organisation
                    </label>
                    <RadioGroup
                        name="orgAction"
                        value={orgAction}
                        onChange={(val) => {
                            setOrgAction(val as "create" | "join");
                            localStorage.setItem("signup-orgAction", val);
                            setCompanyName("");
                            localStorage.removeItem("signup-companyName");
                            setPartnerPhone("");
                            localStorage.removeItem("signup-partnerPhone");
                            setManagerPhone("");
                            localStorage.removeItem("signup-managerPhone");
                            setError(null);
                        }}
                        options={[
                            { value: "create", label: "Create new company", description: "You are starting fresh" },
                            { value: "join", label: "Join existing company", description: "Your company already uses Boldo" },
                        ]}
                    />
                </div>

                {/* Create company form */}
                {orgAction === "create" && (
                    <div className="animate-in fade-in slide-in-from-top-4 duration-300 pt-2">
                        <Input
                            label="Company Name"
                            placeholder="e.g. Mehta Traders"
                            name="signup-company-name"
                            autoComplete="off"
                            value={companyName}
                            onChange={(e) => { setCompanyName(e.target.value); localStorage.setItem("signup-companyName", e.target.value); }}
                            disabled={loading}
                            required
                        />
                    </div>
                )}

                {/* Join company form */}
                {orgAction === "join" && (
                    <div className="animate-in fade-in slide-in-from-top-4 duration-300 flex flex-col gap-6 pt-2">
                        {/* Role selection */}
                        <div className="flex flex-col gap-3">
                            <label className="text-base font-bold text-black">
                                Your Role
                            </label>
                            <RadioGroup
                                name="joinRole"
                                value={role}
                                onChange={(val) => {
                                    setRole(val as "key_partner" | "other_partner");
                                    localStorage.setItem("signup-role", val);
                                    setPartnerPhone("");
                                    localStorage.removeItem("signup-partnerPhone");
                                    setManagerPhone("");
                                    localStorage.removeItem("signup-managerPhone");
                                    setError(null);
                                }}
                                options={[
                                    { value: "key_partner", label: "Key Partner", description: "Owner or major partner" },
                                    { value: "other_partner", label: "Other Partner", description: "Employee or minor partner" },
                                ]}
                            />
                        </div>

                        {/* Key partner: enter another partner's phone */}
                        {role === "key_partner" && (
                            <div className="animate-in fade-in slide-in-from-top-4 duration-300">
                                <div className="relative">
                                    <Input
                                        label="Existing Partner's Phone Number"
                                        placeholder="e.g. 98765 43210"
                                        name="signup-partner-phone"
                                        type="tel"
                                        inputMode="tel"
                                        autoComplete="off"
                                        value={partnerPhone}
                                        onChange={(e) => {
                                            const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                                            setPartnerPhone(val);
                                            localStorage.setItem("signup-partnerPhone", val);
                                        }}
                                        disabled={loading}
                                        required
                                    />
                                </div>
                                <p className="text-sm text-zinc-500 font-medium mt-2 ml-1">
                                    Enter the phone number of any existing partner or owner.
                                    They will be asked to approve your request.
                                </p>
                            </div>
                        )}

                        {/* Other partner: enter manager's phone */}
                        {role === "other_partner" && (
                            <div className="animate-in fade-in slide-in-from-top-4 duration-300">
                                <div className="relative">
                                    <Input
                                        label="Manager's Phone Number"
                                        placeholder="e.g. 98765 43210"
                                        name="signup-manager-phone"
                                        type="tel"
                                        inputMode="tel"
                                        autoComplete="off"
                                        value={managerPhone}
                                        onChange={(e) => {
                                            const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                                            setManagerPhone(val);
                                            localStorage.setItem("signup-managerPhone", val);
                                        }}
                                        disabled={loading}
                                        required
                                    />
                                </div>
                                <p className="text-sm text-zinc-500 font-medium mt-2 ml-1">
                                    Your company will be automatically set based on your manager&apos;s company.
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {error && <p className="text-sm font-medium text-red-500">{error}</p>}

                <Button
                    type="submit"
                    loading={loading}
                    className="w-full text-lg mt-2 shadow-[0_4px_20px_0_rgba(234,179,8,0.4)]"
                >
                    {orgAction === "create"
                        ? "Create Account"
                        : role === "key_partner"
                            ? "Send Join Request"
                            : "Join Organisation"}
                </Button>
            </form>
        </Card>
    );
}

export default function SignupCompletePage() {
    return (
        <main className="min-h-screen flex items-center justify-center p-4 py-12 bg-background">
            <div className="w-full max-w-md my-auto">
                <Suspense fallback={<Card className="p-12 border-none shadow-none bg-transparent flex justify-center"><div className="animate-pulse w-10 h-10 rounded-full bg-zinc-200"></div></Card>}>
                    <SignupCompleteContent />
                </Suspense>
            </div>
        </main>
    );
}
