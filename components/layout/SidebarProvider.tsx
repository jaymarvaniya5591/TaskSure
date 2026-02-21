"use client";

import { createContext, useContext, useState, ReactNode } from "react";

interface SidebarContextType {
    isMobileOpen: boolean;
    setIsMobileOpen: (open: boolean) => void;
    toggleMobileSidebar: () => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function SidebarProvider({ children }: { children: ReactNode }) {
    const [isMobileOpen, setIsMobileOpen] = useState(false);

    const toggleMobileSidebar = () => setIsMobileOpen(prev => !prev);

    return (
        <SidebarContext.Provider value={{ isMobileOpen, setIsMobileOpen, toggleMobileSidebar }}>
            {children}
        </SidebarContext.Provider>
    );
}

export function useSidebar() {
    const context = useContext(SidebarContext);
    if (context === undefined) {
        throw new Error("useSidebar must be used within a SidebarProvider");
    }
    return context;
}
