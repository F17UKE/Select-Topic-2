'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell, LoadingCards, SignInCard } from '../../components/app-shell';
import { CustomerDetailHeader } from '../../components/customer/detail-header';
import { api, baht } from '../../lib/api';
import { useCustomer } from '../../lib/use-customer';

export default function PromotionsPage() {
  const session = useCustomer();
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => { if (!session.customer) return; let active = true; api('/api/promotions').then((result) => { if (active) setItems(result.promotions); }).catch((requestError) => { if (active) setError(requestError.message); }); return () => { active = false; }; }, [session.customer]);
  const header = <CustomerDetailHeader title="โปรโมชัน" backHref="/" />;
  if (session.loading) return <AppShell header={header}><LoadingCards /></AppShell>;
  if (!session.customer) return <AppShell header={header}><SignInCard config={session.authConfig} onLogin={session.devLogin} /></AppShell>;
  return <AppShell variant="engagement" header={header}><div className="engagement-heading"><p>ACTIVE PROMOTIONS</p><h1>สิทธิ์ที่ใช้ได้ตอนนี้</h1><span>ระบบจะตรวจสอบสิทธิ์และคำนวณยอดจริงอีกครั้งที่ Checkout</span></div>{error && <p className="form-error">{error}</p>}<div className="promotion-list">{items.map((item) => <Link href={`/promotions/${item.id}`} key={item.id}><div><strong>{item.name}</strong><span>{item.description || (item.merchant_id ? 'โปรโมชันเฉพาะร้าน' : 'ใช้ได้กับร้านที่ร่วมรายการ')}</span></div><b>{item.promotion_type === 'PERCENTAGE' ? `−${Number(item.value)}%` : item.promotion_type === 'FIXED_AMOUNT' ? `−${baht(item.value)}` : 'ส่งฟรี'}</b><small>ขั้นต่ำ {baht(item.minimum_order_amount)} · ถึง {new Date(item.ends_at).toLocaleDateString('th-TH')}</small></Link>)}</div>{!items.length && !error && <div className="empty-state"><h2>ยังไม่มีโปรโมชัน</h2><p>กลับมาตรวจสอบอีกครั้งภายหลัง</p></div>}</AppShell>;
}
