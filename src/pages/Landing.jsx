import React, { useEffect, useState } from 'react';
import { Icon } from '../components/Icons';
import { BtnGold, BtnGhost } from '../components/UI';
import { useAuth } from '../context/AuthContext';

/* ── Auth Modal ─────────────────────────────────────────────────── */
function AuthModal({ onClose, onDone }) {
  const { loginWithGoogle, loginWithEmail, loading, googleClientId } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!googleClientId) return;
    
    const initGoogle = () => {
      try {
        window.google?.accounts.id.initialize({
          client_id: googleClientId,
          ux_mode: 'popup',
          callback: async (response) => {
            console.log("Google response received");
            const r = await loginWithGoogle(response.credential);
            if (r.success) onDone();
            else setErr(r.error || 'Login failed');
          },
        });
        window.google?.accounts.id.renderButton(
          document.getElementById('g-btn'),
          { theme: 'outline', size: 'large', width: 300, text: 'continue_with' }
        );
      } catch (e) { console.error("GSI Init Error", e); }
    };

    if (!document.getElementById('gsi-script')) {
      const s = document.createElement('script');
      s.id = 'gsi-script';
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = initGoogle;
      document.head.appendChild(s);
    } else {
      initGoogle();
    }
  }, [googleClientId]);

  const handleEmail = async (e) => {
    e.preventDefault();
    if (!email.includes('@')) { setErr('Please enter a valid email.'); return; }
    if (!name.trim()) { setErr('Please enter your name.'); return; }
    setErr('');
    try {
      const r = await loginWithEmail(email, name);
      if (r.success) { setEmailSent(true); }
      else { setErr(r.error || 'Failed to sign in.'); }
    } catch (err) {
      setErr('Connection error. Is the backend running?');
    }
  };

  return (
    <div className="fade-in" style={{ position: 'fixed', inset: 0, background: 'rgba(20,20,20,.6)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="pop-in" style={{ background: '#fff', borderRadius: 20, padding: '40px 44px', width: '100%', maxWidth: 420, boxShadow: '0 24px 60px rgba(0,0,0,.15)', position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'transparent', border: 'none', color: '#9C9487', padding: 6 }}><Icon.X /></button>

        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ width: 44, height: 44, background: '#1B2A4A', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', fontFamily: "'Outfit', sans-serif", fontSize: 24, color: '#C6A96B' }}>C</div>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 26, color: '#1B2A4A', marginBottom: 6 }}>Sign in to Catalyst</h2>
          <div style={{ fontSize: 10, color: '#B5AFA4', fontStyle: 'italic' }}>ID: {googleClientId?.slice(0, 10)}...</div>
        </div>

        {emailSent ? (
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>📩</div>
            <h3 style={{ fontSize: 18, color: '#1B2A4A', marginBottom: 8 }}>Check your inbox</h3>
            <p style={{ fontSize: 14, color: '#6B6456', lineHeight: 1.5 }}>
              We've sent a magic link to <strong>{email}</strong>. Click the link in the email to sign in instantly.
            </p>
            <BtnGhost onClick={() => setEmailSent(false)} style={{ marginTop: 24, fontSize: 13 }}>Try a different email</BtnGhost>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 20 }}>
              <div id="g-btn" />
              {err && <div style={{ fontSize: 13, color: '#9B1C1C', marginTop: 16, padding: '10px', background: '#FFF5F5', borderRadius: 8, width: '100%', textAlign: 'center' }}>{err}</div>}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <div style={{ flex: 1, height: 1, background: '#E8E2D6' }} />
              <span style={{ fontSize: 11, color: '#9C9487', fontWeight: 600, textTransform: 'uppercase' }}>or</span>
              <div style={{ flex: 1, height: 1, background: '#E8E2D6' }} />
            </div>

            <form onSubmit={handleEmail}>
              <div style={{ marginBottom: 12 }}><input className="inp" type="text" placeholder="Full Name" value={name} onChange={e => setName(e.target.value)} style={{ width: '100%', padding: '12px 14px', border: '1.5px solid #E8E2D6', borderRadius: 10, fontSize: 15, background: '#FDFCFA' }} /></div>
              <div style={{ marginBottom: 16 }}><input className="inp" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} style={{ width: '100%', padding: '12px 14px', border: '1.5px solid #E8E2D6', borderRadius: 10, fontSize: 15, background: '#FDFCFA' }} /></div>
              <button type="submit" disabled={loading} className="btn-navy" style={{ width: '100%', background: '#1B2A4A', color: '#fff', border: 'none', padding: '13px', borderRadius: 10, fontSize: 15, fontWeight: 600 }}>{loading ? 'Processing…' : 'Continue with Email →'}</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function Landing({ onEnter }) {
  const { user, logout, verifyMagicLink } = useAuth();
  const [showAuth, setShowAuth] = useState(false);

  // Magic Link Detection
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('verify');
    const email = params.get('email');
    const name = params.get('n');

    if (token && email) {
      const success = verifyMagicLink(email, token, name);
      if (success) {
        // Clear URL and enter
        window.history.replaceState({}, document.title, "/");
        onEnter();
      }
    }
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#F4F1EC' }}>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} onDone={() => setShowAuth(false)} />}
      <nav style={{ background: '#fff', borderBottom: '1px solid #E8E2D6', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 1060, margin: '0 auto', padding: '0 32px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, background: '#1B2A4A', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Outfit', sans-serif", fontSize: 20, color: '#C6A96B' }}>C</div>
            <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, color: '#1B2A4A' }}>Catalyst</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {user ? (
              <>
                <span style={{ fontSize: 14, color: '#5C5447' }}>{user.name}</span>
                <BtnGold onClick={onEnter} style={{ padding: '8px 20px', fontSize: 13 }}>Go to App →</BtnGold>
                <button onClick={logout} style={{ fontSize: 13, color: '#9C9487', background: 'transparent', border: 'none', cursor: 'pointer' }}>Sign out</button>
              </>
            ) : (
              <button onClick={() => setShowAuth(true)} className="btn-navy" style={{ background: '#1B2A4A', color: '#fff', border: 'none', padding: '9px 22px', borderRadius: 8, fontSize: 14, fontWeight: 600 }}>Sign in</button>
            )}
          </div>
        </div>
      </nav>

      <section style={{ maxWidth: 1060, margin: '0 auto', padding: '100px 32px 100px', textAlign: 'center' }}>
        <div className="fade-up">
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 62, lineHeight: 1.1, color: '#1B2A4A', marginBottom: 24, letterSpacing: -1 }}>
            Was your application<br /><em>unfairly rejected?</em>
          </h1>
          <p style={{ fontSize: 20, color: '#6B6456', lineHeight: 1.7, marginBottom: 44, maxWidth: 600, margin: '0 auto 44px' }}>
            Catalyst reveals the invisible factors behind automated decisions — and gives you a structured path to contest them.
          </p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center' }}>
            <BtnGold onClick={() => setShowAuth(true)} style={{ padding: '16px 40px', fontSize: 16 }}>
              Get Started Free &nbsp;<Icon.Arrow />
            </BtnGold>
            <BtnGhost onClick={() => document.getElementById('how').scrollIntoView({ behavior: 'smooth' })} style={{ padding: '16px 30px', fontSize: 16 }}>See how it works</BtnGhost>
          </div>
        </div>
      </section>

      <section id="how" style={{ background: '#fff', borderTop: '1px solid #E8E2D6', padding: '80px 32px' }}>
        <div style={{ maxWidth: 1060, margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 38, color: '#1B2A4A', marginBottom: 44 }}>Four steps to clarity</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 32 }}>
            {[
              { n: '01', t: 'Submit Profile', b: 'Enter basic financial details. No documents needed.' },
              { n: '02', t: 'Get Breakdown', b: 'See every factor ranked by its impact on your result.' },
              { n: '03', t: 'Add Context', b: 'Contest specific factors with evidence or notes.' },
              { n: '04', t: 'Final Verdict', b: 'Receive an explainable delta and manual review.' }
            ].map((s, i) => (
              <div key={i} style={{ textAlign: 'left' }}>
                <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 40, color: '#C6A96B', opacity: .4, marginBottom: 12 }}>{s.n}</div>
                <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{s.t}</h3>
                <p style={{ fontSize: 14, color: '#6B6456', lineHeight: 1.6 }}>{s.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <footer style={{ borderTop: '1px solid #E8E2D6', padding: '40px 32px', textAlign: 'center', fontSize: 13, color: '#9C9487' }}>
        © 2025 Catalyst · Built for Hack Helix · harshakya56@gmail.com
      </footer>
    </div>
  );
}
