"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * TEMPORARY DIAGNOSTIC PAGE — Remove once mobile bugs are resolved.
 *
 * Visually displays the result of every diagnostic check so we can
 * screenshot it on mobile to see exactly what's failing.
 */

interface TestResult {
    name: string;
    status: "running" | "pass" | "fail";
    detail: string;
    elapsed?: number;
}

export default function DiagnosticPage() {
    const [results, setResults] = useState<TestResult[]>([]);
    const [ua, setUa] = useState("");

    const addResult = (name: string, status: TestResult["status"], detail: string, elapsed?: number) => {
        setResults((prev) => {
            const existing = prev.findIndex((r) => r.name === name);
            const entry = { name, status, detail, elapsed };
            if (existing >= 0) {
                const copy = [...prev];
                copy[existing] = entry;
                return copy;
            }
            return [...prev, entry];
        });
    };

    useEffect(() => {
        setUa(navigator.userAgent);
        runDiagnostics();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function runDiagnostics() {
        const supabase = createClient();

        // Test 1: Check auth session
        addResult("Auth Session", "running", "Checking...");
        const t1 = Date.now();
        try {
            const { data, error } = await supabase.auth.getSession();
            if (error) {
                addResult("Auth Session", "fail", `Error: ${error.message}`, Date.now() - t1);
            } else if (!data.session) {
                addResult("Auth Session", "fail", "No session found — user not authenticated", Date.now() - t1);
            } else {
                addResult("Auth Session", "pass",
                    `Token expires: ${new Date(data.session.expires_at! * 1000).toISOString()}, user: ${data.session.user?.id?.slice(0, 8)}...`,
                    Date.now() - t1);
            }
        } catch (err) {
            addResult("Auth Session", "fail", `Exception: ${err}`, Date.now() - t1);
        }

        // Test 2: Check auth user
        addResult("Auth getUser()", "running", "Checking...");
        const t2 = Date.now();
        try {
            const { data, error } = await supabase.auth.getUser();
            if (error) {
                addResult("Auth getUser()", "fail", `Error: ${error.message}`, Date.now() - t2);
            } else {
                addResult("Auth getUser()", "pass", `User: ${data.user?.id?.slice(0, 8)}...`, Date.now() - t2);
            }
        } catch (err) {
            addResult("Auth getUser()", "fail", `Exception: ${err}`, Date.now() - t2);
        }

        // Test 3: Simple table query (users)
        addResult("Query: users table", "running", "Checking...");
        const t3 = Date.now();
        try {
            const { data, error } = await supabase
                .from("users")
                .select("id")
                .limit(1);
            if (error) {
                addResult("Query: users table", "fail", `Error: ${JSON.stringify(error)}`, Date.now() - t3);
            } else {
                addResult("Query: users table", "pass", `Got ${data?.length} row(s)`, Date.now() - t3);
            }
        } catch (err) {
            addResult("Query: users table", "fail", `Exception: ${err}`, Date.now() - t3);
        }

        // Test 4: Tasks query (same as dashboard)
        addResult("Query: tasks table", "running", "Checking...");
        const t4 = Date.now();
        try {
            const { data, error } = await supabase
                .from("tasks")
                .select("id, title")
                .limit(3);
            if (error) {
                addResult("Query: tasks table", "fail", `Error: ${JSON.stringify(error)}`, Date.now() - t4);
            } else {
                addResult("Query: tasks table", "pass", `Got ${data?.length} task(s): ${(data as Array<{ id: string; title: string }>)?.map(t => t.title).join(", ")}`, Date.now() - t4);
            }
        } catch (err) {
            addResult("Query: tasks table", "fail", `Exception: ${err}`, Date.now() - t4);
        }

        // Test 5: Tasks with joins (same query as dashboard queryFn)
        addResult("Query: tasks+joins", "running", "Checking...");
        const t5 = Date.now();
        try {
            const { data, error } = await supabase
                .from("tasks")
                .select("*, created_by:users!tasks_created_by_fkey(id, name), assigned_to:users!tasks_assigned_to_fkey(id, name)")
                .limit(3);
            if (error) {
                addResult("Query: tasks+joins", "fail", `Error: ${JSON.stringify(error)}`, Date.now() - t5);
            } else {
                addResult("Query: tasks+joins", "pass", `Got ${data?.length} enriched task(s)`, Date.now() - t5);
            }
        } catch (err) {
            addResult("Query: tasks+joins", "fail", `Exception: ${err}`, Date.now() - t5);
        }

        // Test 6: Raw fetch to Supabase REST API
        addResult("Raw fetch: Supabase REST", "running", "Checking...");
        const t6 = Date.now();
        try {
            const res = await fetch(
                `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/users?select=id&limit=1`,
                {
                    headers: {
                        "apikey": process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
                        "Authorization": `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
                    },
                    signal: AbortSignal.timeout(5000),
                }
            );
            const body = await res.text();
            addResult("Raw fetch: Supabase REST", res.ok ? "pass" : "fail",
                `Status: ${res.status}, body: ${body.slice(0, 100)}`, Date.now() - t6);
        } catch (err) {
            addResult("Raw fetch: Supabase REST", "fail", `Exception: ${err}`, Date.now() - t6);
        }

        // Test 7: Cookies check
        addResult("Cookies", "running", "Checking...");
        const cookies = document.cookie;
        const sbCookies = cookies.split(";").filter(c => c.trim().startsWith("sb-"));
        addResult("Cookies", sbCookies.length > 0 ? "pass" : "fail",
            `Found ${sbCookies.length} Supabase cookie(s): ${sbCookies.map(c => c.trim().split("=")[0]).join(", ") || "NONE"}`);

        // Test 8: localStorage check
        addResult("LocalStorage", "running", "Checking...");
        try {
            const keys = Object.keys(localStorage).filter(k => k.startsWith("sb-"));
            addResult("LocalStorage", keys.length > 0 ? "pass" : "fail",
                `Found ${keys.length} Supabase key(s): ${keys.join(", ") || "NONE"}`);
        } catch (err) {
            addResult("LocalStorage", "fail", `Exception: ${err}`);
        }
    }

    return (
        <div style={{ padding: 16, fontFamily: "monospace", fontSize: 13, background: "#111", color: "#eee", minHeight: "100vh" }}>
            <h2 style={{ color: "#0ff", marginBottom: 8 }}>🔧 Mobile Diagnostics</h2>
            <p style={{ color: "#888", fontSize: 11, wordBreak: "break-all" }}>UA: {ua}</p>
            <hr style={{ borderColor: "#333" }} />
            {results.map((r) => (
                <div key={r.name} style={{
                    padding: "8px 0",
                    borderBottom: "1px solid #222",
                }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{
                            color: r.status === "pass" ? "#0f0" : r.status === "fail" ? "#f44" : "#ff0",
                            fontWeight: "bold",
                        }}>
                            {r.status === "pass" ? "✅" : r.status === "fail" ? "❌" : "⏳"} {r.name}
                        </span>
                        {r.elapsed !== undefined && (
                            <span style={{ color: "#888" }}>{r.elapsed}ms</span>
                        )}
                    </div>
                    <div style={{ color: "#aaa", fontSize: 11, marginTop: 4, wordBreak: "break-all" }}>
                        {r.detail}
                    </div>
                </div>
            ))}
            <button
                onClick={() => { setResults([]); runDiagnostics(); }}
                style={{
                    marginTop: 16, padding: "10px 20px", background: "#0ff", color: "#000",
                    border: "none", borderRadius: 8, fontWeight: "bold", fontSize: 14
                }}
            >
                Re-run Tests
            </button>
        </div>
    );
}
