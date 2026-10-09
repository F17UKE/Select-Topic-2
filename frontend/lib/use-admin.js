'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';

const AdminContext = createContext(null);

function csrfCookie() {
  if (typeof document === 'undefined') return '';
  const entry = document.cookie.split(';').map((item) => item.trim()).find((item) => item.startsWith('admin_csrf='));
  return entry ? decodeURIComponent(entry.slice('admin_csrf='.length)) : '';
}

export function AdminProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const result = await api('/api/admin/auth/me');
      setAdmin(result.admin);
      setError('');
    } catch (requestError) {
      setAdmin(null);
      if (requestError.status !== 401) setError(requestError.message);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const request = Promise.resolve().then(refresh);
    return () => { void request; };
  }, [refresh]);
  const login = useCallback(async (username, password) => {
    const result = await api('/api/admin/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    setAdmin(result.admin);
    setError('');
    return result.admin;
  }, []);
  const mutate = useCallback((path, options = {}) => api(path, {
    ...options,
    headers: { 'X-CSRF-Token': csrfCookie(), ...options.headers },
  }), []);
  const logout = useCallback(async () => {
    await mutate('/api/admin/auth/logout', { method: 'POST' });
    setAdmin(null);
  }, [mutate]);
  const value = useMemo(() => ({ admin, loading, error, login, logout, mutate, refresh }), [admin, loading, error, login, logout, mutate, refresh]);
  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin() {
  const value = useContext(AdminContext);
  if (!value) throw new Error('useAdmin must be used inside AdminProvider');
  return value;
}
