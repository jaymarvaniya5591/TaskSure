import React, { forwardRef } from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "primary" | "secondary" | "ghost";
    loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className = "", variant = "primary", loading = false, disabled, children, ...props }, ref) => {

        let variantStyles = "";
        switch (variant) {
            case "primary":
                variantStyles = "bg-black text-white hover:bg-zinc-800 shadow-[0_4px_14px_0_rgba(0,0,0,0.2)] active:bg-zinc-900/90";
                break;
            case "secondary":
                variantStyles = "bg-accent-600 text-black hover:bg-accent-500 active:bg-accent-700 shadow-sm";
                break;
            case "ghost":
                variantStyles = "bg-transparent text-black hover:bg-zinc-100 active:bg-zinc-200";
                break;
        }

        return (
            <button
                ref={ref}
                disabled={disabled || loading}
                className={`inline-flex items-center justify-center whitespace-nowrap rounded-full text-base font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 h-[52px] px-8 py-2 w-full ${variantStyles} ${className}`}
                {...props}
            >
                {loading ? (
                    <div className="flex items-center gap-2">
                        <svg
                            className="animate-spin -ml-1 mr-2 h-5 w-5 text-current"
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                        >
                            <circle
                                className="opacity-25"
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                strokeWidth="4"
                            ></circle>
                            <path
                                className="opacity-75"
                                fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            ></path>
                        </svg>
                        Loading...
                    </div>
                ) : (
                    children
                )}
            </button>
        );
    }
);
Button.displayName = "Button";
