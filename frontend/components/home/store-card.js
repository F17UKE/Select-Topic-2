'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { baht } from '../../lib/api';
import { api } from '../../lib/api';
import { Icon } from '../icons';

const homeImageVariants = {
  '/demo/local-kitchen.svg': '/demo/local-kitchen-2.svg',
  '/demo/noodle-house.svg': '/demo/noodle-house-2.svg',
  '/demo/green-bowl.svg': '/demo/green-bowl-2.svg',
};

export function HomeStoreCard({ merchant, addressId, onFavoriteChange }) {
  const href = `/stores/${merchant.id}${addressId ? `?addressId=${addressId}` : ''}`;
  const delivery = merchant.delivery?.available;
  const homeImage = homeImageVariants[merchant.primary_image] || merchant.primary_image;
  const [favorite, setFavorite] = useState(Boolean(merchant.is_favorite));
  const [busy, setBusy] = useState(false);
  async function toggleFavorite() {
    if (busy) return;
    const next = !favorite;
    setFavorite(next); setBusy(true);
    try {
      await api(`/api/customer/favorites/${merchant.id}`, { method: next ? 'POST' : 'DELETE' });
      onFavoriteChange?.(merchant.id, next);
    } catch {
      setFavorite(!next);
    } finally { setBusy(false); }
  }
  return (
    <article className="home-store-card">
      <div className="home-store-image-wrap">
        <Link className="home-store-image-link" href={href} aria-label={`เปิดร้าน ${merchant.store_name}`}>
          {homeImage ? (
            <Image src={homeImage} alt={`ภาพร้าน ${merchant.store_name}`} fill loading="eager" sizes="(max-width: 520px) 38vw, 180px" className="home-store-image" />
          ) : <div className="home-store-image-fallback" aria-hidden="true"><Icon name="home" size={32} /></div>}
          <span className={`home-store-status ${merchant.accepting_orders ? 'is-open' : 'is-closed'}`}>{!merchant.is_active ? 'ระงับชั่วคราว' : merchant.accepting_orders ? 'เปิดอยู่' : 'ปิดชั่วคราว'}</span>
        </Link>
        <button className={`home-favorite ${favorite ? 'is-active' : ''}`} type="button" aria-label={favorite ? `นำ ${merchant.store_name} ออกจากร้านโปรด` : `เพิ่ม ${merchant.store_name} เป็นร้านโปรด`} aria-pressed={favorite} disabled={busy} onClick={toggleFavorite}><Icon name="heart" size={18} /></button>
      </div>
      <Link className="home-store-copy" href={href}>
        <p className="home-store-kind">ร้านอาหารใกล้คุณ</p>
        <h2>{merchant.store_name}</h2>
        <p className="home-store-location"><Icon name="map" size={15} />{merchant.location_text || 'ดูตำแหน่งร้าน'}</p>
        <div className="home-store-facts">
          <span><Icon name="star" size={15} />{merchant.review_count ? `${Number(merchant.average_rating).toFixed(1)} (${merchant.review_count} รีวิว)` : 'ร้านใหม่'}</span>
          <span><Icon name="clock" size={15} />สอบถามเวลา</span>
        </div>
        <div className="home-delivery-info">
          <span>{delivery ? `ค่าส่ง ${baht(merchant.delivery.fee)}` : 'ยังไม่ครอบคลุมพื้นที่'}</span>
          <small>{merchant.delivery?.soi_name || 'เลือกที่อยู่เพื่อดูค่าส่ง'}</small>
        </div>
      </Link>
    </article>
  );
}
