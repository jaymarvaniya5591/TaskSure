"use client";

import { useState, useEffect, useCallback } from "react";

interface KeyboardState {
    isOpen: boolean;
    keyboardHeight: number;
    viewportHeight: number;
    scrollToFocused: () => void;
}

/**
 * Hook to detect mobile virtual keyboard state using the VisualViewport API.
 * Provides a method to cleanly scroll the currently focused input into view.
 */
export function useMobileKeyboard(): KeyboardState {
    const [isOpen, setIsOpen] = useState(false);
    const [keyboardHeight, setKeyboardHeight] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(0);

    useEffect(() => {
        if (typeof window === "undefined" || !window.visualViewport) {
            return;
        }

        const viewport = window.visualViewport;

        // Initial values
        let baseHeight = window.innerHeight;
        setViewportHeight(viewport.height);

        const handleResize = () => {
            // If the window inner height changed significantly, user probably rotated device
            if (Math.abs(window.innerHeight - baseHeight) > 100) {
                baseHeight = window.innerHeight;
            }

            // Keyboard is considered "open" if visual viewport shrinks significantly compared to window layout height
            const currentHeight = viewport.height;
            const isKeyboardOpen = baseHeight - currentHeight > 150;

            setIsOpen(isKeyboardOpen);
            setKeyboardHeight(isKeyboardOpen ? baseHeight - currentHeight : 0);
            setViewportHeight(currentHeight);
        };

        viewport.addEventListener("resize", handleResize);
        viewport.addEventListener("scroll", handleResize);

        // Initial check
        handleResize();

        return () => {
            viewport.removeEventListener("resize", handleResize);
            viewport.removeEventListener("scroll", handleResize);
        };
    }, []);

    const scrollToFocused = useCallback(() => {
        if (typeof document === "undefined") return;

        const activeElement = document.activeElement as HTMLElement;
        if (
            activeElement &&
            (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA" || activeElement.isContentEditable)
        ) {
            // Give the keyboard a tiny bit of time to fully animate in
            setTimeout(() => {
                activeElement.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                    inline: "nearest"
                });
            }, 100);
        }
    }, []);

    // Automatically attempt to scroll when keyboard opens
    useEffect(() => {
        if (isOpen) {
            scrollToFocused();
        }
    }, [isOpen, scrollToFocused]);

    return { isOpen, keyboardHeight, viewportHeight, scrollToFocused };
}
