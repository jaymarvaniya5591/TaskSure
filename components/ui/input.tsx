import React, { forwardRef, useId } from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
    ({ className = "", label, error, ...props }, ref) => {
        const defaultId = useId();
        const id = props.id || defaultId;

        return (
            <div className="flex flex-col gap-1.5 w-full">
                {label && (
                    <label htmlFor={id} className="text-sm font-medium text-stone-700">
                        {label}
                    </label>
                )}
                <input
                    id={id}
                    ref={ref}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    className={`flex h-[52px] w-full rounded-2xl border-2 border-zinc-200 bg-white px-4 py-2 text-base font-medium text-black shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-zinc-400 focus-visible:outline-none focus-visible:border-black focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 ${error ? "border-red-500 focus-visible:border-red-500" : ""
                        } ${className}`}
                    {...props}
                />
                {error && <p className="text-sm text-red-500">{error}</p>}
            </div>
        );
    }
);
Input.displayName = "Input";
