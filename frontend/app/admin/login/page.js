'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAdmin } from '../../../lib/use-admin';

export default function AdminLoginPage() {
  const session = useAdmin();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (session.admin) router.replace('/admin'); }, [session.admin, router]);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await session.login(username, password); router.replace('/admin'); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  }
  return <main className="admin-login"><form onSubmit={submit} className="admin-login-card"><div className="admin-login-mark">ST</div><p>PLATFORM ADMIN</p><h1>เข้าสู่ระบบผู้ดูแล</h1><span>ใช้บัญชี Admin แยกจาก Customer และ Merchant</span><label>ชื่อผู้ใช้<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required /></label><label>รหัสผ่าน<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <div className="admin-alert danger">{error}</div>}<button disabled={busy}>{busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}</button></form></main>;
}
