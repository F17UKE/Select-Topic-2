'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef, useState } from 'react';
import { merchantNavigation } from '../lib/staff-portal.mjs';
import { StaffDevTools } from './staff-dev-tools';
import { Icon } from './icons';

export function MerchantShell({ children, title, backHref, showNav = true, staff, session }) {
  const pathname = usePathname();
  const more = useRef(null);
  const navItems = merchantNavigation(staff?.role);
  const main = navItems.filter((item) => ['/merchant', '/merchant/orders', '/merchant/kitchen'].includes(item.href));
  const extra = navItems.filter((item) => !main.includes(item));
  const active = (href) => href === '/merchant' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const close = () => more.current?.close();
  const navigation = (items) => items.map((item) => <Link href={item.href} key={item.href} onClick={close} aria-current={active(item.href) ? 'page' : undefined}><Icon name={item.icon} /><span>{item.label}</span></Link>);
  const visible = showNav && navItems.length > 0;
  return <div className={`merchant-app portal-app${pathname === "/merchant/kitchen" ? " kds-portal" : ""}${visible ? '' : ' auth-page'}`}>
    <header className="merchant-topbar"><div className="merchant-topbar-inner">
      {backHref ? <Link className="icon-button" href={backHref} aria-label="ย้อนกลับ"><Icon name="back" /></Link> : <div className="merchant-brand">M</div>}
      <p className="merchant-topbar-title">{title || 'หน้าร้าน'}</p><span aria-hidden="true" />
    </div></header>
    {visible && <nav className="portal-desktop-nav" aria-label="จัดการร้าน"><div className="portal-store-heading"><span className="merchant-brand">M</span><strong>{staff?.store_name || "ร้านของคุณ"}</strong></div><p className="portal-nav-label">งานหน้าร้าน</p>{navigation(navItems.filter((item) => ["/merchant", "/merchant/orders", "/merchant/kitchen", "/merchant/menu"].includes(item.href)))}<p className="portal-nav-label">การจัดการ</p>{navigation(navItems.filter((item) => !["/merchant", "/merchant/orders", "/merchant/kitchen", "/merchant/menu"].includes(item.href)))}</nav>}
    <main className="merchant-content">{children}{session?.staff && <StaffDevTools enabled={session.authConfig?.dev_login_enabled} loading={session.loading} onLogin={session.devLogin} />}</main>
    {visible && <>
      <nav className="merchant-nav" aria-label="เมนูร้านค้า">{navigation(main)}
        {extra.length > 0 && <button type="button" aria-haspopup="dialog" onClick={() => more.current?.showModal()}><Icon name="receipt" /><span>เพิ่มเติม</span></button>}
      </nav>
      <dialog ref={more} className="portal-menu-dialog" aria-labelledby="merchant-more-title">
        <div className="portal-dialog-heading"><h2 id="merchant-more-title">เพิ่มเติม</h2><button type="button" onClick={close} autoFocus>ปิด</button></div>
        <nav aria-label="ส่วนจัดการเพิ่มเติม">{navigation(extra)}</nav>{session && <button className="merchant-logout" onClick={session.logout}>ออกจากระบบ</button>}
      </dialog>
    </>}
  </div>;
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
      {passwordMode ? (
        <div className="staff-login-fields">
          <label>
            ชื่อผู้ใช้
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label>
            รหัสผ่าน
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button
            className="merchant-primary"
            type="button"
            onClick={() => onLogin(username, password)}
            disabled={loading}
          >
            เข้าสู่ระบบ
          </button>
        </div>
      ) : (
        !config?.dev_login_enabled && <div className="notice">ระบบยืนยันตัวตนยังไม่พร้อมใช้งาน</div>
      )}
      <StaffDevTools enabled={config?.dev_login_enabled} loading={loading} onLogin={onLogin} />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
