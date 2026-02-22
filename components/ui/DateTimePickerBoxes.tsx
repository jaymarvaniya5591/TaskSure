"use client";

import React, { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

interface DateTimePickerBoxesProps {
    value: string; // ISO string
    onChange: (isoString: string) => void;
    onError?: (hasError: boolean) => void;
}

export default function DateTimePickerBoxes({
    value,
    onChange,
    onError,
}: DateTimePickerBoxesProps) {
    const d = value ? new Date(value) : new Date();

    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(-2);

    let hours = d.getHours();
    const isPM = hours >= 12;
    const ampm = isPM ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12; // '0' should be '12'
    const hh = String(hours).padStart(2, "0");
    const mins = String(d.getMinutes()).padStart(2, "0");

    const [chars, setChars] = useState<string[]>([
        dd[0], dd[1],
        mm[0], mm[1],
        yy[0], yy[1],
        hh[0], hh[1],
        mins[0], mins[1],
    ]);

    const [ap, setAp] = useState<"AM" | "PM">(ampm as "AM" | "PM");
    const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

    useEffect(() => {
        const hasEmpty = chars.some((c) => c === "");
        if (hasEmpty) {
            onError?.(true);
            return;
        }

        const dStr = chars.slice(0, 2).join("");
        const mStr = chars.slice(2, 4).join("");
        const yStr = chars.slice(4, 6).join("");
        const hStr = chars.slice(6, 8).join("");
        const minStr = chars.slice(8, 10).join("");

        const day = parseInt(dStr, 10);
        const month = parseInt(mStr, 10) - 1;
        const year = parseInt(yStr, 10) + 2000;
        let hour = parseInt(hStr, 10);
        const minute = parseInt(minStr, 10);

        if (ap === "PM" && hour !== 12) hour += 12;
        else if (ap === "AM" && hour === 12) hour = 0;

        const dateObj = new Date(year, month, day, hour, minute);

        // Validate valid date (e.g. no Feb 31)
        if (
            dateObj.getFullYear() === year &&
            dateObj.getMonth() === month &&
            dateObj.getDate() === day &&
            !isNaN(dateObj.getTime())
        ) {
            onError?.(false);
            onChange(dateObj.toISOString());
        } else {
            // Invalid date like 31 Feb
            onError?.(true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chars, ap]);

    const handleChange = (index: number, val: string) => {
        const numericVal = val.replace(/\D/g, ""); // only digits
        if (!numericVal && val !== "") return; // prevent typing letters

        const newChars = [...chars];
        const insertedChar = numericVal.slice(-1);
        newChars[index] = insertedChar;
        setChars(newChars);

        // Auto focus next box
        if (numericVal && index < 9) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    const handleKeyDown = (
        index: number,
        e: React.KeyboardEvent<HTMLInputElement>
    ) => {
        if (e.key === "Backspace") {
            if (!chars[index] && index > 0) {
                // box is empty, focus prev and clear it?
                // Just focusing is safer
                inputRefs.current[index - 1]?.focus();
            } else {
                const newChars = [...chars];
                newChars[index] = "";
                setChars(newChars);
            }
        } else if (e.key === "ArrowLeft" && index > 0) {
            inputRefs.current[index - 1]?.focus();
        } else if (e.key === "ArrowRight" && index < 9) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    const handleInputPaste = (
        e: React.ClipboardEvent<HTMLInputElement>
    ) => {
        e.preventDefault();
        const pasteData = e.clipboardData.getData("text").replace(/\D/g, "");
        if (!pasteData) return;

        const newChars = [...chars];
        let pasteIndex = 0;

        // Find the first empty input to start pasting into, or default to 0
        let startIndex = chars.findIndex(c => c === "");
        if (startIndex === -1) startIndex = 0;

        for (let i = startIndex; i < 10 && pasteIndex < pasteData.length; i++) {
            newChars[i] = pasteData[pasteIndex];
            pasteIndex++;
        }
        setChars(newChars);

        // Focus the last filled or next empty
        const nextIndex = Math.min(startIndex + pasteData.length, 9);
        inputRefs.current[nextIndex]?.focus();
    };

    const Box = ({ index }: { index: number }) => (
        <input
            ref={(el) => {
                inputRefs.current[index] = el;
            }}
            value={chars[index]}
            onChange={(e) => handleChange(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            onPaste={handleInputPaste}
            className="w-10 h-12 text-center text-lg font-bold bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition-all outline-none"
            maxLength={1}
            inputMode="numeric"
            pattern="[0-9]*"
        />
    );

    return (
        <div className="flex flex-col gap-5">
            {/* Date Row */}
            <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest pl-1">Date</span>
                <div className="flex items-center gap-1.5 sm:gap-2">
                    {/* DD */}
                    <div className="flex items-center gap-1">
                        <Box index={0} />
                        <Box index={1} />
                    </div>
                    <span className="text-gray-300 font-black px-0.5 sm:px-1 text-xl">/</span>
                    {/* MM */}
                    <div className="flex items-center gap-1">
                        <Box index={2} />
                        <Box index={3} />
                    </div>
                    <span className="text-gray-300 font-black px-0.5 sm:px-1 text-xl">/</span>
                    {/* YY */}
                    <div className="flex items-center gap-1">
                        <Box index={4} />
                        <Box index={5} />
                    </div>
                </div>
                <div className="text-[10px] font-semibold text-gray-400 tracking-widest pl-1">DD/MM/YY</div>
            </div>

            {/* Time Row */}
            <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest pl-1">Time</span>
                <div className="flex items-center gap-1.5 sm:gap-2">
                    {/* HH */}
                    <div className="flex items-center gap-1">
                        <Box index={6} />
                        <Box index={7} />
                    </div>
                    <span className="text-gray-300 font-black px-0.5 sm:px-1 text-xl">:</span>
                    {/* mm */}
                    <div className="flex items-center gap-1">
                        <Box index={8} />
                        <Box index={9} />
                    </div>

                    <div className="relative ml-1 sm:ml-2">
                        <select
                            value={ap}
                            onChange={(e) => setAp(e.target.value as "AM" | "PM")}
                            className={cn(
                                "appearance-none h-12 pl-4 pr-10 font-bold border rounded-xl transition-all outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 cursor-pointer text-lg",
                                "bg-gray-50 border-gray-200 text-gray-900 focus:bg-white"
                            )}
                        >
                            <option value="AM" className="font-bold">AM</option>
                            <option value="PM" className="font-bold">PM</option>
                        </select>
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-400">
                            <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
                        </div>
                    </div>
                </div>
                <div className="text-[10px] font-semibold text-gray-400 tracking-widest pl-1">HH:MM</div>
            </div>
        </div>
    );
}
