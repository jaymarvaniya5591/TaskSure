"use client";

import React from "react";

export interface RadioOption {
    value: string;
    label: string;
    description?: string;
}

export interface RadioGroupProps {
    name: string;
    options: RadioOption[];
    value: string;
    onChange: (value: string) => void;
    className?: string;
}

export function RadioGroup({ name, options, value, onChange, className = "" }: RadioGroupProps) {
    return (
        <div className={`flex flex-col gap-3 ${className}`}>
            {options.map((option) => {
                const checked = value === option.value;
                return (
                    <label
                        key={option.value}
                        className={`relative flex cursor-pointer rounded-2xl border-2 p-5 shadow-sm transition-all focus-within:ring-2 focus-within:ring-black focus-within:ring-offset-2 ${checked ? "border-black bg-accent-50/50" : "border-zinc-200 bg-white hover:bg-zinc-50"
                            }`}
                    >
                        <div className="flex items-center h-6">
                            <input
                                type="radio"
                                name={name}
                                value={option.value}
                                checked={checked}
                                onChange={() => onChange(option.value)}
                                className="h-4 w-4 border-zinc-300 text-black focus:ring-black focus:ring-offset-0 disabled:opacity-50 sr-only"
                            />
                            <div
                                className={`flex items-center justify-center w-6 h-6 rounded-full border-2 transition-colors ${checked ? "border-black bg-black" : "border-zinc-300"
                                    }`}
                            >
                                {checked && <div className="w-2.5 h-2.5 rounded-full bg-accent-500" />}
                            </div>
                        </div>
                        <div className="ml-4 flex flex-col">
                            <span className={`block text-lg font-bold tracking-tight ${checked ? "text-black" : "text-zinc-600"}`}>
                                {option.label}
                            </span>
                            {option.description && (
                                <span className={`block text-sm mt-0.5 ${checked ? "text-zinc-800 font-medium" : "text-zinc-500"}`}>
                                    {option.description}
                                </span>
                            )}
                        </div>
                    </label>
                );
            })}
        </div>
    );
}
