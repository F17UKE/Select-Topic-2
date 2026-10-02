'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { api } from '../lib/api';
import { isInLiffClient } from '../lib/liff-auth';
import { isStaffBrowserPath, resolveCustomerBrowserAccess } from '../lib/customer-access-policy.mjs';

function LineClientRequired({ detail }) {
  return (
    <main className="line-client-gate">
      <div className="line-client-mark" aria-hidden="true">LINE</div>
      <p className="eyebrow">CUSTOMER ACCESS</p>
      <h1>กรุณาเปิดผ่าน LINE</h1>
      <p>บริการสำหรับลูกค้าใช้งานผ่าน LINE เท่านั้น กรุณาเปิดลิงก์นี้จากแอป LINE</p>
      {detail && <p className="line-client-detail" role="status">{detail}</p>}
    </main>
  );
}

export function CustomerAccessGate({ children }) {
  const pathname = usePathname();
  const staffPath = isStaffBrowserPath(pathname);
  const [state, setState] = useState({ pathname: null, status: 'loading', detail: '' });

  useEffect(() => {
    let active = true;
    if (isStaffBrowserPath(pathname)) return () => { active = false; };

    api('/api/auth/config').then(async (config) => {
      let inClient = false;
      if (config.mode === 'line') inClient = await isInLiffClient(config.liff_id);
      if (!active) return;
      setState({
        pathname,
        status: resolveCustomerBrowserAccess({ pathname, authMode: config.mode, isInClient: inClient }),
        detail: '',
      });
    }).catch(() => {
      if (active) setState({ pathname, status: 'line_client_required', detail: 'ไม่สามารถตรวจสอบ LINE LIFF ได้ในขณะนี้' });
    });
    return () => { active = false; };
  }, [pathname]);

  if (staffPath || (state.pathname === pathname && state.status === 'allowed')) return children;
  if (state.pathname !== pathname) return <main className="line-client-gate" aria-busy="true"><p>กำลังตรวจสอบ LINE…</p></main>;
  if (state.status === 'line_client_required') return <LineClientRequired detail={state.detail} />;
  return <main className="line-client-gate" aria-busy="true"><p>กำลังตรวจสอบ LINE…</p></main>;
}
