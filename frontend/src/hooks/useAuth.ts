import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../services/api';
import type { User } from '../types';

export const useAuth = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loginError, setLoginError] = useState(false);
  const [isLoginLoading, setIsLoginLoading] = useState(false);

  const checkAuth = useCallback(async () => {
    console.log('[Auth] Checking current authentication status...');
    try {
      const res = await fetch(`${API_BASE}/api/auth/check`, { credentials: 'include' });
      const data = await res.json();
      setIsAuthenticated(data.authenticated);
      if (data.authenticated && data.user) {
        setCurrentUser(data.user);
      } else {
        setCurrentUser(null);
      }
    } catch (err) {
      console.error('[Auth] Check failed:', err);
      setIsAuthenticated(false);
      setCurrentUser(null);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (username: string, password: string) => {
    setLoginError(false);
    setIsLoginLoading(true);
    const loginUrl = `${API_BASE}/api/auth/login`;

    try {
      const res = await fetch(loginUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password: password.trim() }),
        credentials: 'include'
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        setCurrentUser(data.user);
        setIsAuthenticated(true);
        return { success: true };
      } else {
        setLoginError(true);
        return { success: false, error: data.error || 'Identifiants incorrects' };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Erreur réseau: ${message}` };
    } finally {
      setIsLoginLoading(false);
    }
  };

  const logout = async () => {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch (e) {
      console.error('[Auth] Logout request failed', e);
    } finally {
      setIsAuthenticated(false);
      setCurrentUser(null);
    }
  };

  const updateProfile = async (params: { username?: string; password?: string; avatarUrl?: string | null }) => {
    try {
      const res = await fetch(`${API_BASE}/api/users/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        credentials: 'include'
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCurrentUser(data.user);
        return { success: true };
      } else {
        return { success: false, error: data.error || 'Update failed' };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  };

  return {
    isAuthenticated,
    currentUser,
    loginError,
    isLoginLoading,
    login,
    logout,
    checkAuth,
    updateProfile
  };
};
