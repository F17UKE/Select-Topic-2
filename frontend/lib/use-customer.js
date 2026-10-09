'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { customerErrorMessage } from './customer-error.mjs';
import { api, ApiError } from './api';
import { getLiffIdToken } from './liff-auth';

async function fetchSession() {
  const [config, session] = await Promise.all([
    api('/api/auth/config'),
    api('/api/auth/me').catch((requestError) => {
      if (requestError instanceof ApiError && requestError.status === 401) return null;
      throw requestError;
    }),
  ]);
  return { config, session };
}

export function useCustomer() {
  const [customer, setCustomer] = useState(null);
  const [authConfig, setAuthConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const lineAttempted = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { config, session } = await fetchSession();
      setAuthConfig(config);
      setCustomer(session?.customer || null);
    } catch (requestError) {
      setError(customerErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetchSession().then(({ config, session }) => {
      if (!active) return;
      setAuthConfig(config);
      setCustomer(session?.customer || null);
      setLoading(false);
    }).catch((requestError) => {
      if (!active) return;
      setError(customerErrorMessage(requestError));
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const devLogin = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let result;
      if (authConfig?.mode === 'line') {
        const idToken = await getLiffIdToken(authConfig.liff_id);
        if (!idToken) return;
        result = await api('/api/auth/line', { method: 'POST', body: JSON.stringify({ idToken }) });
      } else {
        result = await api('/api/dev/auth/login', { method: 'POST' });
      }
      setCustomer(result.customer);
    } catch (requestError) {
      setError(customerErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [authConfig]);

  useEffect(() => {
    if (loading || customer || authConfig?.mode !== 'line' || lineAttempted.current) return;
    lineAttempted.current = true;
    devLogin();
  }, [authConfig, customer, devLogin, loading]);

  return { customer, authConfig, loading, error, refresh, devLogin, setCustomer };
}
