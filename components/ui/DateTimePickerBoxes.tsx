"use client";

import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown } from "lucide-react";

interface DateTimePickerBoxesProps {
    value: string; // ISO string
    onChange: (isoString: string) => void;
    onError?: (hasError: boolean) => void;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface SpinnerSegmentProps {
    value: string;
    onUp: () => void;
    onDown: () => void;
    onCommit?: (val: string) => void;
    maxLength?: number;
    width?: string;
    isAmpm?: boolean;
    onToggleAmpm?: () => void;
}

const SpinnerSegment = ({
    value,
    onUp,
    onDown,
    onCommit,
    maxLength = 2,
    width = "w-9 sm:w-11",
    isAmpm = false,
    onToggleAmpm,
}: SpinnerSegmentProps) => {
    const [localValue, setLocalValue] = useState(value);
    const [isFocused, setIsFocused] = useState(false);

    useEffect(() => {
        if (!isFocused) {
            setLocalValue(value);
        }
    }, [value, isFocused]);

    const handleBlur = () => {
        setIsFocused(false);
        if (localValue.trim() === "") {
            setLocalValue(value);
        } else {
            onCommit?.(localValue);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.currentTarget.blur();
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            onUp();
        } else if (e.key === "ArrowDown") {
            e.preventDefault();
            onDown();
        }
    };

    return (
        <div className="flex flex-col items-center">
            <button
                onClick={onUp}
                type="button"
                className="text-gray-400 hover:text-gray-800 p-1 sm:p-1.5 focus:outline-none focus:text-black"
                tabIndex={-1}
            >
                <ChevronUp className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            {isAmpm ? (
                <button
                    type="button"
                    onClick={onToggleAmpm}
                    className={cn(
                        width,
                        "text-center text-base sm:text-lg font-black rounded-lg hover:bg-gray-100 transition-colors py-1 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
                    )}
                >
                    {value}
                </button>
            ) : (
                <input
                    type="text"
                    inputMode={value.match(/^[a-zA-Z]+$/) ? "text" : "numeric"}
                    className={cn(
                        width,
                        "text-center text-lg sm:text-xl font-black bg-transparent outline-none p-0 focus:bg-gray-100 rounded-lg transition-colors"
                    )}
                    value={isFocused ? localValue : value}
                    onChange={(e) => setLocalValue(e.target.value)}
                    onFocus={() => {
                        setIsFocused(true);
                        setLocalValue(""); // remove completely on click so they can type immediately
                    }}
                    onBlur={handleBlur}
                    onKeyDown={handleKeyDown}
                    maxLength={maxLength}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                />
            )}

            <button
                onClick={onDown}
                type="button"
                className="text-gray-400 hover:text-gray-800 p-1 sm:p-1.5 focus:outline-none focus:text-black"
                tabIndex={-1}
            >
                <ChevronDown className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
        </div>
    );
};

export default function DateTimePickerBoxes({
    value,
    onChange,
    onError,
}: DateTimePickerBoxesProps) {
    const initialDate = value ? new Date(value) : new Date();

    const [dd, setDd] = useState<number>(initialDate.getDate());
    const [mon, setMon] = useState<number>(initialDate.getMonth());
    const [yy, setYy] = useState<number>(initialDate.getFullYear());

    const h = initialDate.getHours();
    const [ap, setAp] = useState<"AM" | "PM">(h >= 12 ? "PM" : "AM");
    const [hh, setHh] = useState<number>(h % 12 || 12);
    const [mm, setMm] = useState<number>(initialDate.getMinutes());

    const daysInMonth = new Date(yy, mon + 1, 0).getDate();

    useEffect(() => {
        let hour24 = hh;
        if (ap === "PM" && hh !== 12) hour24 += 12;
        else if (ap === "AM" && hh === 12) hour24 = 0;

        const dateObj = new Date(yy, mon, dd, hour24, mm);

        // Ensure date is strictly valid
        if (
            dateObj.getFullYear() === yy &&
            dateObj.getMonth() === mon &&
            dateObj.getDate() === dd &&
            !isNaN(dateObj.getTime())
        ) {
            onError?.(false);
            onChange(dateObj.toISOString());
        } else {
            onError?.(true);
        }
    }, [dd, mon, yy, hh, mm, ap, onChange, onError]);

    // Validation helpers
    const validateClamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val));

    // DD handlers
    const incDD = () => setDd((d) => (d >= daysInMonth ? 1 : d + 1));
    const decDD = () => setDd((d) => (d <= 1 ? daysInMonth : d - 1));
    const commitDD = (val: string) => {
        const parsed = parseInt(val, 10);
        if (!isNaN(parsed)) setDd(validateClamp(parsed, 1, daysInMonth));
    };

    // MM handlers
    const incMon = () => setMon((m) => (m >= 11 ? 0 : m + 1));
    const decMon = () => setMon((m) => (m <= 0 ? 11 : m - 1));
    const commitMon = (val: string) => {
        const parsed = parseInt(val, 10);
        if (!isNaN(parsed)) {
            setMon(validateClamp(parsed, 1, 12) - 1);
        } else {
            const idx = MONTHS.findIndex((m) => m.toLowerCase().startsWith(val.toLowerCase()));
            if (idx !== -1) setMon(idx);
        }
    };

    // YY handlers
    const incYy = () => setYy((y) => y + 1);
    const decYy = () => setYy((y) => Math.max(2000, y - 1));
    const commitYy = (val: string) => {
        const parsed = parseInt(val, 10);
        if (!isNaN(parsed)) {
            setYy(parsed < 100 ? 2000 + parsed : parsed);
        }
    };

    // HH handlers
    const incHh = () => setHh((h) => (h >= 12 ? 1 : h + 1));
    const decHh = () => setHh((h) => (h <= 1 ? 12 : h - 1));
    const commitHh = (val: string) => {
        const parsed = parseInt(val, 10);
        if (!isNaN(parsed)) setHh(validateClamp(parsed, 1, 12));
    };

    // mm handlers
    const incMm = () => setMm((m) => (m >= 59 ? 0 : m + 1));
    const decMm = () => setMm((m) => (m <= 0 ? 59 : m - 1));
    const commitMm = (val: string) => {
        const parsed = parseInt(val, 10);
        if (!isNaN(parsed)) setMm(validateClamp(parsed, 0, 59));
    };

    // AM/PM handlers
    const toggleAp = () => setAp((a) => (a === "AM" ? "PM" : "AM"));

    return (
        <div className="w-full flex flex-col gap-4 p-4 rounded-2xl border-2 bg-white text-black shadow-sm transition-colors focus-within:border-black border-zinc-200">
            {/* Date Segment */}
            <div className="flex flex-col items-center w-full">
                <span className="text-[10px] sm:text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Date</span>
                <div className="flex items-center justify-center gap-1 sm:gap-2 w-full">
                    <SpinnerSegment
                        value={String(dd).padStart(2, "0")}
                        onUp={incDD}
                        onDown={decDD}
                        onCommit={commitDD}
                        width="w-10 sm:w-14"
                    />
                    <span className="text-gray-300 font-black text-xl sm:text-2xl">/</span>
                    <SpinnerSegment
                        value={MONTHS[mon]}
                        onUp={incMon}
                        onDown={decMon}
                        onCommit={commitMon}
                        maxLength={3}
                        width="w-14 sm:w-16"
                    />
                    <span className="text-gray-300 font-black text-xl sm:text-2xl">/</span>
                    <SpinnerSegment
                        value={String(yy).slice(-2)}
                        onUp={incYy}
                        onDown={decYy}
                        onCommit={commitYy}
                        width="w-10 sm:w-14"
                    />
                </div>
            </div>

            <div className="w-full h-px bg-gray-100" />

            {/* Time Segment */}
            <div className="flex flex-col items-center w-full">
                <span className="text-[10px] sm:text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Time</span>
                <div className="flex items-center justify-center gap-1 sm:gap-2 w-full">
                    <SpinnerSegment
                        value={String(hh).padStart(2, "0")}
                        onUp={incHh}
                        onDown={decHh}
                        onCommit={commitHh}
                        width="w-10 sm:w-14"
                    />
                    <span className="text-gray-300 font-black text-xl sm:text-2xl">:</span>
                    <SpinnerSegment
                        value={String(mm).padStart(2, "0")}
                        onUp={incMm}
                        onDown={decMm}
                        onCommit={commitMm}
                        width="w-10 sm:w-14"
                    />
                    <div className="ml-2 sm:ml-4">
                        <SpinnerSegment
                            value={ap}
                            onUp={toggleAp}
                            onDown={toggleAp}
                            isAmpm
                            onToggleAmpm={toggleAp}
                            width="w-14 sm:w-16"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
