'use client';
import { useState } from 'react';

export function StaffDevTools({ enabled, loading, onLogin }) {
  const [username, setUsername] = useState('local_manager');
  if (process.env.NODE_ENV === 'production' || !enabled) return null;
  return <details className="staff-dev-tools"><summary>Developer tools</summary>
    <label>บัญชีตัวอย่าง<select value={username} onChange={(event) => setUsername(event.target.value)} disabled={loading}>
      <option value="local_manager">MANAGER</option><option value="local_cashier">CASHIER</option>
      <option value="local_kitchen">KITCHEN</option><option value="local_rider">RIDER</option>
    </select></label>
    <button type="button" disabled={loading} onClick={() => onLogin(username)}>{loading ? 'กำลังเข้าสู่ระบบ…' : 'สลับบัญชีตัวอย่าง'}</button>
  </details>;
}
