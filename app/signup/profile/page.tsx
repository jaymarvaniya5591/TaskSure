"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RadioGroup } from "@/components/ui/radio-group";

function SignupContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const supabase = createClient();

    const phone = searchParams.get("phone");

    const [fullName, setFullName] = useState("");
    const [orgAction, setOrgAction] = useState<"create" | "join">("create");
    const [orgName, setOrgName] = useState("");
    const [managerName, setManagerName] = useState("");

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!phone) {
            router.replace("/signup");
        }
    }, [phone, router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!phone) return;

        if (!fullName.trim()) {
            setError("Please enter your full name.");
            return;
        }

        if (!orgName.trim()) {
            setError(orgAction === "create" ? "Please enter your organisation name." : "Please enter the organisation name to join.");
            return;
        }

        setError(null);
        setLoading(true);

        try {
            // Get the authenticated user's ID — this MUST be used as the users table id
            const { data: { user: authUser } } = await supabase.auth.getUser();
            if (!authUser) throw new Error("Not authenticated. Please try again.");

            let orgId: string;
            let userRole: string;

            if (orgAction === "create") {
                // Create new org
                // Generate a slug from name
                const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

                const { data: orgData, error: orgError } = await supabase
                    .from('organisations')
                    .insert({ name: orgName, slug })
                    .select('id')
                    .single();

                if (orgError) throw orgError;
                if (!orgData) throw new Error("Failed to create organisation");

                orgId = orgData.id;
                userRole = "owner";
            } else {
                // Join existing org
                const { data: orgData, error: orgError } = await supabase
                    .from('organisations')
                    .select('id')
                    .ilike('name', orgName)
                    .single();

                if (orgError || !orgData) {
                    throw new Error(`Could not find an organisation named "${orgName}". Please check the spelling or ask your owner to invite you.`);
                }

                orgId = orgData.id;
                userRole = "member";
            }

            let managerId = null;

            // If joining and provided a manager name
            if (orgAction === "join" && managerName.trim()) {
                const { data: managerData } = await supabase
                    .from('users')
                    .select('id')
                    .eq('organisation_id', orgId)
                    .ilike('name', managerName.trim())
                    .single();

                if (managerData) {
                    managerId = managerData.id;
                } else {
                    // Store missing name to resolve later if desired
                    // For now, we just insert the user without a manager.
                }
            }

            // Insert User — CRITICAL: id must match auth.uid() for RLS to work
            const { error: userError } = await supabase
                .from('users')
                .insert({
                    id: authUser.id,
                    name: fullName,
                    phone_number: phone,
                    organisation_id: orgId,
                    role: userRole,
                    reporting_manager_id: managerId,
                });

            if (userError) {
                // Specifically catch the "duplicate key value violates unique constraint" if they refresh page
                if (userError.code === '23505') {
                    router.push('/home');
                    return;
                }
                throw userError;
            }

            // Success, go to dashboard
            router.push('/home');

        } catch (err) {
            console.error(err);
            setError(err instanceof Error ? err.message : "Failed to complete profile. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    if (!phone) return null;

    return (
        <Card className="border-none shadow-none bg-transparent px-0 sm:px-8">
            <div className="mb-10">
                <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-black mb-3">
                    Complete Profile.
                </h1>
                <p className="text-lg text-zinc-500 font-medium">
                    Set up your account to get started
                </p>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-8">
                <Input
                    label="Full Name"
                    placeholder="e.g. Ramesh Bhai"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    disabled={loading}
                    required
                />

                <div className="flex flex-col gap-3 pt-4 border-t-2 border-zinc-100">
                    <label className="text-lg font-bold text-black mb-1">
                        Organisation
                    </label>
                    <RadioGroup
                        name="orgAction"
                        value={orgAction}
                        onChange={(val) => {
                            setOrgAction(val as "create" | "join");
                            setOrgName("");
                            setManagerName("");
                            setError(null);
                        }}
                        options={[
                            { value: "create", label: "Create new organisation", description: "You are the business owner" },
                            { value: "join", label: "Join existing organisation", description: "Your company already uses Boldo" }
                        ]}
                    />
                </div>

                {orgAction === "create" && (
                    <div className="animate-in fade-in slide-in-from-top-4 duration-300 pt-2">
                        <Input
                            label="Business Name"
                            placeholder="e.g. Mehta Traders"
                            value={orgName}
                            onChange={(e) => setOrgName(e.target.value)}
                            disabled={loading}
                            required
                        />
                    </div>
                )}

                {orgAction === "join" && (
                    <div className="animate-in fade-in slide-in-from-top-4 duration-300 flex flex-col gap-8 pt-2">
                        <Input
                            label="Business Name to Join"
                            placeholder="e.g. Mehta Traders"
                            value={orgName}
                            onChange={(e) => setOrgName(e.target.value)}
                            disabled={loading}
                            required
                        />

                        <div className="flex flex-col gap-2">
                            <Input
                                label="Reporting Manager Name (Optional)"
                                placeholder="e.g. Suresh Patel"
                                value={managerName}
                                onChange={(e) => setManagerName(e.target.value)}
                                disabled={loading}
                            />
                            <p className="text-sm text-zinc-500 font-medium ml-1">
                                Leave blank if you do not have a manager or do not know their name.
                            </p>
                        </div>
                    </div>
                )}

                {error && <p className="text-sm font-medium text-red-500">{error}</p>}

                <Button type="submit" loading={loading} className="w-full text-lg mt-4 shadow-[0_4px_20px_0_rgba(234,179,8,0.4)]">
                    {orgAction === "create" ? "Create Account" : "Join Organisation"}
                </Button>
            </form>
        </Card>
    );
}

export default function SignupPage() {
    return (
        <main className="min-h-screen flex items-center justify-center p-4 py-12 bg-background">
            <div className="w-full max-w-md my-auto">
                <Suspense fallback={<Card className="p-12 border-none shadow-none bg-transparent flex justify-center"><div className="animate-pulse w-10 h-10 rounded-full bg-zinc-200"></div></Card>}>
                    <SignupContent />
                </Suspense>
            </div>
        </main>
    );
}
