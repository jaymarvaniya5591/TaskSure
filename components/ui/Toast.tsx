"use client";

/**
 * Toast — Lightweight notification popup.
 * Shows at the top of the screen, auto-hides after a delay.
 * Use the global `showToast()` function from anywhere.
 */

import { useState, useEffect, createContext, useContext, useCallback, type ReactNode } from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastType = "success" | "error" | "info";

interface ToastData {
    id: number;
    message: string;
    type: ToastType;
}

interface ToastContextValue {
    showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
    return ctx;
}

let globalId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<ToastData[]>([]);

    const showToast = useCallback((message: string, type: ToastType = "success") => {
        const id = ++globalId;
        setToasts((prev) => [...prev, { id, message, type }]);
    }, []);

    const removeToast = useCallback((id: number) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            {/* Toast container */}
            <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[99999] flex flex-col items-center gap-2 pointer-events-none">
                {toasts.map((toast) => (
                    <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
                ))}
            </div>
        </ToastContext.Provider>
    );
}

function ToastItem({ toast, onRemove }: { toast: ToastData; onRemove: (id: number) => void }) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        // Animate in
        requestAnimationFrame(() => setVisible(true));
        // Auto-dismiss after 2.5s
        const timer = setTimeout(() => {
            setVisible(false);
            setTimeout(() => onRemove(toast.id), 300);
        }, 2500);
        return () => clearTimeout(timer);
    }, [toast.id, onRemove]);

    const Icon = toast.type === "error" ? AlertCircle : CheckCircle2;
    const colors = {
        success: "bg-emerald-600 text-white",
        error: "bg-red-600 text-white",
        info: "bg-gray-900 text-white",
    };

    return (
        <div
            className={cn(
                "pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-2xl text-sm font-semibold transition-all duration-300 min-w-[200px] max-w-[90vw]",
                colors[toast.type],
                visible ? "opacity-100 translate-y-0 scale-100" : "opacity-0 -translate-y-3 scale-95"
            )}
        >
            <Icon className="w-4.5 h-4.5 shrink-0" />
            <span className="flex-1">{toast.message}</span>
            <button
                onClick={() => {
                    setVisible(false);
                    setTimeout(() => onRemove(toast.id), 300);
                }}
                className="p-0.5 hover:bg-white/20 rounded-lg transition-colors shrink-0"
            >
                <X className="w-3.5 h-3.5" />
            </button>
        </div>
    );
}
