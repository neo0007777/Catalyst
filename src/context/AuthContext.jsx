import React, { createContext, useContext, useState, useEffect } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    // Persist session in sessionStorage (cleared on tab close)
    try { return JSON.parse(sessionStorage.getItem('catalyst_user')) || null; }
    catch { return null; }
  });
  const [loading, setLoading] = useState(false);

  const loginWithGoogle = async (credential) => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
      });
      if (!res.ok) throw new Error('Token verification failed');
      const data = await res.json();
      const u = data.user;
      setUser(u);
      sessionStorage.setItem('catalyst_user', JSON.stringify(u));
      // Fire welcome email (non-blocking)
      fetch(`${API}/api/auth/send-welcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: u.email, name: u.name }),
      }).catch(() => {});
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    } finally {
      setLoading(false);
    }
  };

  const loginWithEmail = async (email, name) => {
    setLoading(true);
    try {
      await fetch(`${API}/api/auth/send-welcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name: name || email.split('@')[0] }),
      });
      return { success: true };
    } catch {
      return { success: false, error: "Failed to send verification email." };
    } finally {
      setLoading(false);
    }
  };

  const verifyMagicLink = (email, token, encodedName) => {
    // Demo verification logic: matches the mock token from backend
    const expectedToken = email.replace("@", "-at-").replace(".", "-dot-");
    if (token === expectedToken) {
      let decodedName = email.split('@')[0];
      if (encodedName) {
        try { decodedName = atob(encodedName); } catch(e) {}
      }
      const u = { email, name: decodedName, picture: null, sub: null };
      setUser(u);
      sessionStorage.setItem('catalyst_user', JSON.stringify(u));
      return true;
    }
    return false;
  };

  const logout = () => {
    setUser(null);
    sessionStorage.removeItem('catalyst_user');
    window.location.hash = ''; // Clear hash if any
  };

  return (
    <AuthCtx.Provider value={{ user, loading, loginWithGoogle, loginWithEmail, verifyMagicLink, logout, googleClientId: GOOGLE_CLIENT_ID }}>
      {children}
    </AuthCtx.Provider>
  );
}
