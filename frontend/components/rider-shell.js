'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Icon } from './icons';

export function RiderShell({ children, title = 'งานจัดส่ง', backHref, showNav = true }) {
  const pathname = usePathname();
  const navItems = [
    { href: '/rider', label: 'ภาพรวม', icon: 'home', active: pathname === '/rider' },
    { href: '/rider/orders', label: 'งานของฉัน', icon: 'receipt', active: pathname.startsWith('/rider/orders') },
  ];
  return (
    <div className={`rider-app${showNav ? '' : ' auth-page'}`}>
      <header className="rider-topbar"><div className="rider-topbar-inner">
        {backHref ? <Link className="rider-icon-button" href={backHref} aria-label="ย้อนกลับ"><Icon name="back" /></Link> : <div className="rider-brand">R</div>}
        <p className="rider-topbar-title">{title}</p><span aria-hidden="true" />
      </div></header>
      <main className="rider-content">{children}</main>
      {showNav && <nav className="rider-nav" aria-label="เมนูไรเดอร์">{navItems.map((item) => <Link href={item.href} className={item.active ? 'is-active' : ''} aria-current={item.active ? 'page' : undefined} key={item.href}><Icon name={item.icon} /><span>{item.label}</span></Link>)}</nav>}
    </div>
  );
}

export function RiderSignIn({ session }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  if (session.staff && session.staff.role !== 'RIDER') {
    return <section className="rider-signin"><div className="rider-brand large">R</div><h1>สลับเป็นบัญชีไรเดอร์</h1><p>ขณะนี้เข้าสู่ระบบเป็น {session.staff.role}</p><button className="rider-secondary" type="button" onClick={session.logout}>ออกจากบัญชีพนักงาน</button></section>;
  }
  const passwordMode = session.authConfig?.mode === 'password';
  return <section className="rider-signin"><div className="rider-brand large">R</div><h1>เข้าสู่ระบบไรเดอร์</h1><p>เข้าสู่ระบบเพื่อดูงานที่ได้รับมอบหมาย</p>{passwordMode ? <div className="staff-login-fields"><label>ชื่อผู้ใช้<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label><label>รหัสผ่าน<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className="rider-primary" type="button" disabled={session.loading} onClick={() => session.passwordLogin(username, password)}>เข้าสู่ระบบ</button></div> : !session.authConfig?.dev_login_enabled && <div className="rider-notice">ระบบยืนยันตัวตนยังไม่พร้อมใช้งาน</div>}{session.authConfig?.dev_login_enabled && <div className="staff-dev-login"><span>สำหรับการทดสอบบนเครื่องนี้</span><p>ใช้บัญชีไรเดอร์ตัวอย่างเพื่อดูงานบน Local</p><button className="rider-secondary" type="button" disabled={session.loading} onClick={() => session.devLogin('local_rider')}>{session.loading ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบด้วยบัญชีตัวอย่าง'}</button></div>}{session.error && <p className="form-error" role="alert">{session.error}</p>}</section>;
}
