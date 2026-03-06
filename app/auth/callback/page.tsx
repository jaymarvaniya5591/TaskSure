/**
 * /auth/callback — Server Component with server-rendered skeleton.
 *
 * The skeleton HTML paints INSTANTLY from CDN before any JS loads.
 *
 * Flow 1 (verify_token — 99% of traffic): Handled by a tiny inline <script>.
 *   No React, no Supabase SDK. Just fetch() + redirect. ~600 bytes.
 *
 * Flow 2 (token_hash — rare magic link fallback): Handled by MagicLinkLoader,
 *   a dynamically-imported client component that loads Supabase SDK on-demand.
 *
 * AUTH FLOW: COMPLETELY UNCHANGED. Same endpoints, same params, same logic.
 * verify-link/route.ts and auth-links.ts are NOT modified.
 */

import MagicLinkLoader from "./AuthClientRouter";

function AuthSkeleton() {
    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            background: '#fdfdfd',
            backgroundImage: 'radial-gradient(circle, #b0b0bc 1.2px, transparent 1.2px)',
            backgroundSize: '18px 18px',
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            zIndex: 9999,
        }}>
            <style dangerouslySetInnerHTML={{
                __html: `
                @keyframes auth-spin {
                    to { transform: rotate(360deg); }
                }
                @keyframes auth-fade-in {
                    from { opacity: 0; transform: translateY(8px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}} />

            <div style={{
                background: 'rgba(255, 255, 255, 0.85)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                borderRadius: 24,
                padding: '48px 40px',
                maxWidth: 380,
                width: '90%',
                textAlign: 'center' as const,
                boxShadow: '0 4px 24px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)',
                border: '1px solid rgba(0,0,0,0.06)',
                animation: 'auth-fade-in 0.3s ease-out',
            }}>
                <div style={{
                    fontSize: 28, fontWeight: 800, color: '#000',
                    letterSpacing: '-0.5px', marginBottom: 32,
                }}>Boldo</div>

                <div style={{
                    width: 44, height: 44,
                    border: '4px solid #e5e7eb', borderTopColor: '#000',
                    borderRadius: '50%', animation: 'auth-spin 0.7s linear infinite',
                    margin: '0 auto 24px',
                }} />

                <p id="auth-status" style={{
                    color: '#000', fontSize: 18, fontWeight: 600,
                    margin: '0 0 8px', letterSpacing: '-0.3px',
                }}>Signing you in...</p>

                <p style={{
                    color: '#6b7280', fontSize: 14, fontWeight: 400,
                    margin: 0, lineHeight: 1.4,
                }}>This will only take a moment</p>
            </div>
        </div>
    );
}

export default function AuthCallbackPage() {
    return (
        <>
            <AuthSkeleton />

            {/*
              Flow 1: verify_token — Inline script, zero JS imports.
              Same fetch() call as the original React handleVerifyToken function:
              /api/auth/verify-link?token=xxx&_api=1 with credentials:'include'
            */}
            <script dangerouslySetInnerHTML={{
                __html: `
(function(){
  var s=document.getElementById('auth-status');
  var p=new URLSearchParams(location.search);
  var t=p.get('verify_token');
  if(!t) return;

  function fail(msg){if(s)s.textContent=msg;setTimeout(function(){location.href='/login?error=auth_failed'},2000);}

  fetch('/api/auth/verify-link?token='+encodeURIComponent(t)+'&_api=1',{credentials:'include'})
    .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
    .then(function(d){
      if(d.redirect){if(s)s.textContent="You're in!";location.href=d.redirect;}
      else fail('Something went wrong');
    })
    .catch(function(e){console.error('[AuthCallback] verify-link error:',e);fail('Connection error');});
})();
`
            }} />

            {/* Flow 2: token_hash — Client component loaded on demand (rare) */}
            <MagicLinkLoader />

            {/* No params fallback */}
            <script dangerouslySetInnerHTML={{
                __html: `
(function(){
  var p=new URLSearchParams(location.search);
  if(!p.get('verify_token')&&!p.get('token_hash')){
    var s=document.getElementById('auth-status');
    if(s)s.textContent='Missing token';
    setTimeout(function(){location.href='/login?error=missing_token'},2000);
  }
})();
`
            }} />
        </>
    );
}
