'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './icons';
import { useCart } from '../lib/cart';

export function AppShell({ children, title, backHref, header, variant, hideBottomNav = false }) {
  const { count } = useCart();
  const pathname = usePathname();
  const navItems = [
    { href: '/', label: 'หน้าแรก', icon: 'home', active: pathname === '/' },
    { href: '/cart', label: 'ตะกร้า', icon: 'cart', active: pathname.startsWith('/cart') || pathname.startsWith('/checkout') },
    { href: '/orders', label: 'สถานะ', icon: 'receipt', active: pathname.startsWith('/orders') },
  ];
  return (
    <div className={`app-shell${variant ? ` ${variant}-shell` : ''}`}>
      {header || <header className="topbar">
        <div className="topbar-inner">
          {backHref ? <Link className="icon-button" href={backHref} aria-label="ย้อนกลับ"><Icon name="back" /></Link> : <div className="brand-mark" aria-hidden="true"><Icon name="scooter" /></div>}
          <div className="topbar-copy">
            <p className="eyebrow">อร่อยใกล้คุณ</p>
            <p className="topbar-title">{title || 'อร่อยใกล้หอ'}</p>
          </div>
        </div>
      </header>}
      <main className={`page-content${variant ? ` ${variant}-page-content` : ''}`}>{children}</main>
      {!hideBottomNav && !/^\/orders\/[^/]+\/payment\/?$/.test(pathname) && <nav className="bottom-nav customer-bottom-nav" aria-label="เมนูหลัก">
        {navItems.map((item) => (
          <Link key={item.href} href={item.href} className={`${item.icon === 'cart' ? 'nav-cart ' : ''}${item.active ? 'is-active' : ''}`} aria-current={item.active ? 'page' : undefined}>
            <Icon name={item.icon} />
            {item.icon === 'cart' && count > 0 && <b className="cart-badge">{count > 9 ? '9+' : count}</b>}
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>}
    </div>
  );
}

export function SignInCard({ config, loading, error, onLogin }) {
  return (
    <section className="signin-card">
      <div className="signin-illustration" aria-hidden="true"><Icon name="scooter" size={48} /></div>
      <p className="eyebrow">มื้ออร่อยใกล้คุณ</p>
      <h1>เริ่มค้นหาร้านอร่อยใกล้คุณ</h1>
      <p>เข้าสู่ระบบเพื่อใช้ที่อยู่สำหรับคำนวณค่าส่งและบันทึกโปรไฟล์ลูกค้า</p>
      {config?.dev_login_enabled || config?.mode === 'line' ? (
        <button className="primary-button" type="button" onClick={onLogin} disabled={loading}>
          {loading ? 'กำลังเข้าสู่ระบบ…' : config?.mode === 'line' ? 'เข้าสู่ระบบด้วย LINE' : 'เข้าใช้ด้วยลูกค้าตัวอย่าง'}
        </button>
      ) : (
        <div className="notice">การเข้าสู่ระบบยังไม่พร้อมใช้งาน</div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      {config?.dev_login_enabled && <p className="helper-text">กำลังใช้ลูกค้าตัวอย่างสำหรับทดลองในเครื่อง</p>}
    </section>
  );
}

export function LoadingCards() {
  return <div className="loading-grid" aria-label="กำลังโหลด"><div/><div/><div/></div>;
}
