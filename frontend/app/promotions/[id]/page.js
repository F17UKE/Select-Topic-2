'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell, LoadingCards, SignInCard } from '../../../components/app-shell';
import { CustomerDetailHeader } from '../../../components/customer/detail-header';
import { useCustomer } from '../../../lib/use-customer';
import { api, baht } from '../../../lib/api';

export default function PromotionPage({ params }) {
  const { id } = use(params);
  const session = useCustomer();
  const [promotion, setPromotion] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!session.customer) return;
    let active = true;
    api(`/api/promotions/${id}`).then((result) => { if (active) setPromotion(result.promotion); })
      .catch(() => { if (active) setError('โปรโมชันนี้ไม่พร้อมใช้งานหรือหมดอายุแล้ว'); });
    return () => { active = false; };
  }, [id, session.customer]);
  return <AppShell header={<CustomerDetailHeader title="โปรโมชัน" backHref="/" />}>
    {session.loading ? <LoadingCards /> : !session.customer ? <SignInCard config={session.authConfig} loading={session.loading} error={session.error} onLogin={session.devLogin} /> : error ? <div className="notice">{error}</div> : !promotion ? <LoadingCards /> : <section className="checkout-section">
      <h1>{promotion.name}</h1><p>{promotion.description}</p>
      <p>{promotion.promotion_type === 'PERCENTAGE' ? `ลด ${Number(promotion.value)}%` : promotion.promotion_type === 'FIXED_AMOUNT' ? `ลด ${baht(promotion.value)}` : 'ส่วนลดค่าจัดส่ง'}</p>
      <p>ค่าอาหารขั้นต่ำ {baht(promotion.minimum_order_amount)}{promotion.maximum_discount_amount !== null && ` · ลดสูงสุด ${baht(promotion.maximum_discount_amount)}`}</p>
      <p>สิ้นสุด {new Date(promotion.ends_at).toLocaleString('th-TH')}</p>
      <p>เลือกโปรโมชันนี้ในหน้าตรวจสอบออเดอร์ ระบบจะตรวจสิทธิ์อีกครั้งก่อนยืนยัน ใช้ได้หนึ่งโปรโมชันต่อออเดอร์</p>
      <Link className="primary-button" href={promotion.merchant_id ? `/stores/${promotion.merchant_id}` : '/'}>เลือกร้านและเมนู</Link>
    </section>}
  </AppShell>;
}
