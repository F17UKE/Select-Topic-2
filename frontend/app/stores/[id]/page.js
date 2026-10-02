'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppShell, LoadingCards, SignInCard } from '../../../components/app-shell';
import { CustomerDetailHeader } from '../../../components/customer/detail-header';
import { Icon } from '../../../components/icons';
import { api, baht } from '../../../lib/api';
import { useCustomer } from '../../../lib/use-customer';

function MenuCard({ item }) {
  return (
    <Link className={`menu-card ${!item.is_available ? 'unavailable' : ''}`} href={`/menu/${item.id}`}>
      <div className="menu-copy">
        <h3>{item.name}</h3>
        <p>{item.description || 'เมนูแนะนำจากทางร้าน'}</p>
        <div className="menu-card-footer"><strong>{baht(item.price)}</strong><Icon name="arrow" size={17} /></div>
        {!item.is_available && <span className="sold-out">หมดชั่วคราว</span>}
      </div>
      {item.image_url && <div className="menu-thumb"><Image src={item.image_url} alt="" fill sizes="120px" /></div>}
    </Link>
  );
}

export default function StoreDetailPage() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const session = useCustomer();
  const [merchant, setMerchant] = useState(null);
  const [activeCategoryId, setActiveCategoryId] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!session.customer) return;
    const addressId = searchParams.get('addressId');
    api(`/api/merchants/${id}${addressId ? `?addressId=${addressId}` : ''}`)
      .then((result) => {
        setMerchant(result.merchant);
        setActiveCategoryId(result.merchant.categories[0]?.id || null);
      })
      .catch((requestError) => setError(requestError.message));
  }, [id, searchParams, session.customer]);

  const detailHeader = <CustomerDetailHeader title={merchant?.store_name || 'รายละเอียดร้าน'} backHref="/" />;
  if (session.loading || (session.customer && !merchant && !error)) return <AppShell variant="customer-detail" header={detailHeader}><LoadingCards /></AppShell>;
  if (!session.customer) return <AppShell variant="customer-detail" header={detailHeader}><SignInCard config={session.authConfig} loading={session.loading} error={session.error} onLogin={session.devLogin} /></AppShell>;
  if (error) return <AppShell variant="customer-detail" header={detailHeader}><div className="empty-state"><h1>ไม่พบร้านนี้</h1><p>{error}</p></div></AppShell>;

  return (
    <AppShell variant="customer-detail" header={detailHeader}>
      <section className="gallery" aria-label="รูปภาพร้าน">
        {merchant.gallery.length ? merchant.gallery.map((image) => <div className="gallery-slide" key={image.id}><Image src={image.image_url} alt={image.alt_text || merchant.store_name} fill priority={image.is_primary} sizes="(max-width: 720px) 88vw, 620px" /></div>) : <div className="gallery-slide gallery-fallback"><Icon name="home" size={42} /><span>ยังไม่มีรูปภาพร้าน</span></div>}
      </section>
      <section className="store-hero-copy">
        <div className="store-title-row"><div><h1>{merchant.store_name}</h1><p className="store-subtitle">{merchant.location_text}</p></div><span className={`store-status static ${merchant.is_open ? 'is-open' : 'is-closed'}`}>{merchant.is_open ? 'เปิดอยู่' : 'ปิดชั่วคราว'}</span></div>
        <p><Icon name="map" size={19} />{merchant.location_text}</p>
        <p><Icon name="phone" size={19} />{merchant.phone}</p>
        <div className="delivery-overview">
          <article><Icon name="scooter" size={21} /><div><span>ค่าส่ง</span><strong>{merchant.delivery?.available ? baht(merchant.delivery.fee) : 'ยังไม่ครอบคลุม'}</strong><small>{merchant.delivery?.soi_name || 'ที่อยู่หลัก'}</small></div></article>
          <article><Icon name="clock" size={21} /><div><span>เวลา</span><strong>สอบถามเวลา</strong><small>ขึ้นอยู่กับคิวของร้าน</small></div></article>
        </div>
      </section>
      <nav className="category-chips" aria-label="หมวดหมู่เมนู">
        {merchant.categories.map((category) => <a className={activeCategoryId === category.id ? 'is-active' : ''} href={`#category-${category.id}`} onClick={() => setActiveCategoryId(category.id)} key={category.id}>{category.name}</a>)}
      </nav>
      <div className="menu-sections">
        {merchant.categories.map((category) => (
          <section id={`category-${category.id}`} key={category.id}>
            <div className="section-heading"><h2>{category.name}</h2><span>{category.items.length} เมนู</span></div>
            <div className="menu-list">{category.items.map((item) => <MenuCard item={item} key={item.id} />)}</div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
