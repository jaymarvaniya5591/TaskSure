"use client";

import React, { useRef, useState, useEffect } from "react";

export interface OtpInputProps {
    length?: number;
    value: string;
    onChange: (value: string) => void;
    error?: string;
    disabled?: boolean;
}

export function OtpInput({ length = 6, value, onChange, error, disabled = false }: OtpInputProps) {
    const [internalValue, setInternalValue] = useState<string[]>(Array(length).fill(""));
    const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

    // Sync external value to internal array
    useEffect(() => {
        if (value === "") {
            setInternalValue(Array(length).fill(""));
            return;
        }
        const valArray = value.split("").slice(0, length);
        const paddedArray = [...valArray, ...Array(length - valArray.length).fill("")];
        setInternalValue(paddedArray);
    }, [value, length]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
        const newValue = e.target.value;
        // Keep only numbers
        if (!/^[0-9]*$/.test(newValue)) return;

        const newInternalValue = [...internalValue];
        // Take the last character typed
        newInternalValue[index] = newValue.slice(-1);

        const mergedValue = newInternalValue.join("");
        onChange(mergedValue);

        // Auto-advance
        if (newValue && index < length - 1) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
        if (e.key === "Backspace" && !internalValue[index] && index > 0) {
            // Auto-backspace
            inputRefs.current[index - 1]?.focus();
        }
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault();
        const pastedData = e.clipboardData.getData("text/plain").replace(/[^0-9]/g, "").slice(0, length);
        if (!pastedData) return;

        onChange(pastedData);

        // Focus next available input or last
        const focusIndex = Math.min(pastedData.length, length - 1);
        inputRefs.current[focusIndex]?.focus();
    };

    return (
        <div className="flex flex-col gap-2">
            <div className="flex gap-2 sm:gap-3 justify-center w-full px-1">
                {internalValue.map((digit, index) => (
                    <input
                        key={index}
                        ref={(el) => {
                            inputRefs.current[index] = el;
                        }}
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        data-form-type="other"
                        pattern="\d{1}"
                        maxLength={length} // allow pasting full string
                        value={digit}
                        onChange={(e) => handleChange(e, index)}
                        onKeyDown={(e) => handleKeyDown(e, index)}
                        onPaste={handlePaste}
                        disabled={disabled}
                        className={`flex-1 aspect-square max-w-14 text-center text-xl sm:text-2xl font-bold rounded-2xl border-2 bg-white text-black shadow-sm transition-colors focus-visible:outline-none focus-visible:border-black focus-visible:ring-0 disabled:opacity-50 disabled:cursor-not-allowed ${error ? "border-red-500" : "border-zinc-200"
                            }`}
                    />
                ))}
            </div>
            {error && <p className="text-sm text-red-500 text-center">{error}</p>}
        </div>
    );
}
