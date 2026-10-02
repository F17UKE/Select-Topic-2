'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Icon } from './icons';

export function MerchantShell({ children, title, backHref, showNav = true }) {
  const pathname = usePathname();
  const navItems = [
    { href: '/merchant', label: 'ภาพรวม', icon: 'home', active: pathname === '/merchant' },
    { href: '/merchant/orders', label: 'ออเดอร์', icon: 'receipt', active: pathname.startsWith('/merchant/orders') },
    { href: '/merchant/kitchen', label: 'ครัว', icon: 'check', active: pathname.startsWith('/merchant/kitchen') },
  ];
  return (
    <div className={`merchant-app${showNav ? '' : ' auth-page'}`}>
      <header className="merchant-topbar">
        <div className="merchant-topbar-inner">
          {backHref ? <Link className="icon-button" href={backHref} aria-label="ย้อนกลับ"><Icon name="back" /></Link> : <div className="merchant-brand">M</div>}
          <p className="merchant-topbar-title">{title || 'หน้าร้าน'}</p>
          <span aria-hidden="true" />
        </div>
      </header>
      <main className="merchant-content">{children}</main>
      {showNav && <nav className="merchant-nav" aria-label="เมนูร้านค้า">{navItems.map((item) => <Link href={item.href} className={item.active ? 'is-active' : ''} aria-current={item.active ? 'page' : undefined} key={item.href}><Icon name={item.icon} /><span>{item.label}</span></Link>)}</nav>}
    </div>
  );
}

export function MerchantSignIn({ config, loading, error, onLogin }) {
  const [username, setUsername] = useState('local_manager');
  const [password, setPassword] = useState('');
  const passwordMode = config?.mode === 'password';
  return (
    <section className="merchant-signin">
      <div className="merchant-brand large">M</div>
      <h1>เข้าสู่ระบบร้านค้า</h1>
      <p>สำหรับเจ้าของร้านและพนักงาน</p>
      {passwordMode ? <div className="staff-login-fields">
        <label>ชื่อผู้ใช้<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
        <label>รหัสผ่าน<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <button className="merchant-primary" type="button" onClick={() => onLogin(username, password)} disabled={loading}>เข้าสู่ระบบ</button>
      </div> : !config?.dev_login_enabled && <div className="notice">ระบบยืนยันตัวตนยังไม่พร้อมใช้งาน</div>}
      {config?.dev_login_enabled && <div className="staff-dev-login"><span>สำหรับการทดสอบบนเครื่องนี้</span><label>บัญชีตัวอย่าง<select value={username} onChange={(event) => setUsername(event.target.value)}><option value="local_manager">MANAGER</option><option value="local_cashier">CASHIER</option><option value="local_kitchen">KITCHEN</option></select></label><button className="merchant-secondary" type="button" onClick={() => onLogin(username)} disabled={loading}>{loading ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบด้วยบัญชีตัวอย่าง'}</button></div>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}
