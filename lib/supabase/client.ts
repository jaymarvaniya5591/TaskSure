import { createBrowserClient } from '@supabase/ssr'

let client: ReturnType<typeof createBrowserClient> | null = null;
let useProxy = false;

if (typeof window !== 'undefined') {
    try {
        useProxy = localStorage.getItem('supabase_proxy_required') === '1';
    } catch {
        // Ignore
    }
}

export function createClient() {
    if (!client) {
        client = createBrowserClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                global: {
                    fetch: async (input, init) => {
                        // In the browser, intercept requests to the real Supabase URL
                        if (typeof window !== 'undefined' && typeof input === 'string' && input.startsWith(process.env.NEXT_PUBLIC_SUPABASE_URL!)) {
                            const path = input.replace(process.env.NEXT_PUBLIC_SUPABASE_URL!, '');
                            const proxyUrl = `${window.location.origin}/supabase-proxy${path}`;

                            if (useProxy) {
                                return fetch(proxyUrl, init);
                            }

                            try {
                                // Try direct connection first (fast path)
                                const response = await fetch(input, init);
                                return response;
                            } catch (error) {
                                console.warn('[Supabase proxy] Direct connection failed, falling back to proxy:', error);

                                if (error instanceof Error && error.name !== 'AbortError') {
                                    useProxy = true;
                                    try {
                                        localStorage.setItem('supabase_proxy_required', '1');
                                    } catch {
                                        // Ignore
                                    }
                                }

                                // Retry via proxy
                                return fetch(proxyUrl, init);
                            }
                        }
                        return fetch(input, init);
                    }
                }
            }
        );
    }
    return client;
}
