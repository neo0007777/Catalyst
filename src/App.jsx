/**
 * App.jsx — Root router
 * Handles: Landing (unauthenticated) ↔ AppPage (authenticated)
 */
import React, { useState } from 'react';
import { useAuth } from './context/AuthContext.jsx';
import Landing from './pages/Landing.jsx';
import AppPage from './pages/AppPage.jsx';

export default function App() {
  const { user, logout } = useAuth();

  // If not authenticated, show landing
  if (!user) return <Landing onEnter={() => {}} />;

  // Authenticated: go straight to the app
  return <AppPage onSignOut={() => logout()} />;
}
