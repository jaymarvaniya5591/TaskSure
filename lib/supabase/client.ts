import { createBrowserClient } from '@supabase/ssr'

let client: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
    if (!client) {
        client = createBrowserClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                global: {
                    fetch: (input, init) => {
                        // In the browser, intercept requests to the real Supabase URL and
                        // proxy them through our Next.js backend to bypass strict cellular
                        // network blocking/DNS failures (e.g., Jio/Airtel 5G in India).
                        if (typeof window !== 'undefined' && typeof input === 'string' && input.startsWith(process.env.NEXT_PUBLIC_SUPABASE_URL!)) {
                            const path = input.replace(process.env.NEXT_PUBLIC_SUPABASE_URL!, '');
                            const proxyUrl = `${window.location.origin}/supabase-proxy${path}`;
                            return fetch(proxyUrl, init);
                        }
                        return fetch(input, init);
                    }
                }
            }
        );
    }
    return client;
}
