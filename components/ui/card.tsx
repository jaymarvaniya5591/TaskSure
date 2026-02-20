import React from "react";

export function Card({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={`rounded-[32px] bg-white text-black p-6 sm:p-8 ${className}`}
            {...props}
        >
            {children}
        </div>
    );
}
