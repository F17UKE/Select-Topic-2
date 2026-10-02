'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';

async function fetchSession() {
  const [config, session] = await Promise.all([
    api('/api/merchant/auth/config'),
    api('/api/merchant/auth/me').catch((error) => {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }),
  ]);
  return { config, session };
}

export function useMerchantStaff() {
  const [staff, setStaff] = useState(null);
  const [authConfig, setAuthConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { config, session } = await fetchSession();
      setAuthConfig(config);
      setStaff(session?.staff || null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetchSession().then(({ config, session }) => {
      if (!active) return;
      setAuthConfig(config);
      setStaff(session?.staff || null);
      setLoading(false);
    }).catch((requestError) => {
      if (!active) return;
      setError(requestError.message);
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const devLogin = useCallback(async (username) => {
    setLoading(true);
    setError('');
    try {
      const result = await api('/api/dev/merchant/auth/login', {
        method: 'POST', body: JSON.stringify({ username }),
      });
      setStaff(result.staff);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const passwordLogin = useCallback(async (username, password) => {
    setLoading(true);
    setError('');
    try {
      const result = await api('/api/merchant/auth/login', {
        method: 'POST', body: JSON.stringify({ username, password }),
      });
      setStaff(result.staff);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await api('/api/merchant/auth/logout', { method: 'POST' });
    setStaff(null);
  }, []);

  const login = useCallback((username, password) => (
    authConfig?.mode === 'password' ? passwordLogin(username, password) : devLogin(username)
  ), [authConfig, devLogin, passwordLogin]);

  return { staff, authConfig, loading, error, refresh, devLogin, passwordLogin, login, logout };
}
