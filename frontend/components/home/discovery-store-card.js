'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { api, baht } from '../../lib/api';
import { Icon } from '../icons';
import styles from './home.module.css';

export function DiscoveryStoreCard({ merchant, addressId, onFavoriteChange, promotion }) {
  const [failedImage, setFailedImage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const href = `/stores/${merchant.id}${addressId ? `?addressId=${addressId}` : ''}`;
  const favorite = Boolean(merchant.is_favorite);
  const available = merchant.delivery?.available;
  const freeDelivery = available && Number(merchant.delivery.fee) === 0;
  const image = merchant.primary_image;

  async function toggleFavorite() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/customer/favorites/${merchant.id}`, { method: favorite ? 'DELETE' : 'POST' });
      onFavoriteChange(merchant, !favorite);
    } catch {
      setError('บันทึกร้านโปรดไม่สำเร็จ ลองอีกครั้ง');
    } finally { setBusy(false); }
  }

  return <article className={styles.storeCard}>
    <div className={`${styles.storeVisual} ${!merchant.accepting_orders ? styles.storeClosed : ''}`}>
      <Link href={href} aria-label={`เปิดร้าน ${merchant.store_name}`} tabIndex={-1}>
        {image && image !== failedImage ? <Image src={image} alt={`ภาพร้าน ${merchant.store_name}`} fill sizes="(max-width: 639px) calc(100vw - 32px), 354px" unoptimized={!image.startsWith('/demo/')} loading="lazy" className={styles.storeImage} onError={() => setFailedImage(image)} /> : <div className={styles.storeFallback}><Icon name="home" size={38} /><span>{merchant.store_name}</span></div>}
      </Link>
      <span className={`${styles.storeStatus} ${merchant.accepting_orders ? styles.open : styles.closed}`}><i />{merchant.is_active === false ? 'ระงับชั่วคราว' : merchant.accepting_orders ? 'เปิดอยู่' : 'ปิดชั่วคราว'}</span>
      <button className={`${styles.favoriteButton} ${favorite ? styles.favoriteActive : ''}`} type="button" aria-label={`${favorite ? 'นำ' : 'เพิ่ม'} ${merchant.store_name} ${favorite ? 'ออกจากร้านโปรด' : 'เป็นร้านโปรด'}`} aria-pressed={favorite} disabled={busy} onClick={toggleFavorite}><Icon name="heart" size={20} /></button>
    </div>
    <Link href={href} className={styles.storeBody}>
      <div className={styles.storeTitle}><h3>{merchant.store_name}</h3><span className={styles.rating}>{merchant.review_count > 0 ? <><Icon name="star" size={14} />{Number(merchant.average_rating).toFixed(1)}<small>({merchant.review_count} รีวิว)</small></> : 'ร้านใหม่'}</span></div>
      <p className={styles.storeLocation}><Icon name="map" size={14} /><span>{merchant.location_text || 'ดูรายละเอียดและตำแหน่งร้าน'}</span></p>
      <div className={styles.deliveryRow}><span className={freeDelivery ? styles.freeDelivery : ''}><Icon name="scooter" size={17} />{available ? freeDelivery ? 'จัดส่งฟรี' : `ค่าส่ง ${baht(merchant.delivery.fee)}` : addressId ? 'อยู่นอกพื้นที่จัดส่ง' : 'เลือกที่อยู่เพื่อดูค่าส่ง'}</span>{available && merchant.delivery.soi_name && <small>{merchant.delivery.soi_name}</small>}</div>
    </Link>
    {promotion && <Link className={styles.storePromo} href={`/promotions/${promotion.id}`} title={promotion.name}><Icon name="ticket" size={14} /><span>{promotion.promotion_type === 'FREE_DELIVERY' ? 'ส่งฟรี' : promotion.promotion_type === 'PERCENTAGE' ? `ลด ${Number(promotion.value)}%` : promotion.promotion_type === 'FIXED_AMOUNT' ? `ลด ${baht(promotion.value)}` : promotion.name}</span><Icon name="arrow" size={14} /></Link>}
    {error && <p className={styles.inlineError} role="alert">{error}</p>}
  </article>;
}
