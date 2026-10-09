import Link from 'next/link';
import { Icon } from '../icons';
import { baht } from '../../lib/api';
import styles from './home.module.css';

export function PromotionCard({ promotion, merchants }) {
  return <Link className={styles.promotion} href={`/promotions/${promotion.id}`}>
    <div className={styles.promotionTop}><Icon name={promotion.promotion_type === 'FREE_DELIVERY' ? 'scooter' : 'ticket'} size={22} /><strong>{promotion.promotion_type === 'PERCENTAGE' ? `ลด ${Number(promotion.value)}%` : promotion.promotion_type === 'FIXED_AMOUNT' ? `ลด ${baht(promotion.value)}` : 'ส่งฟรี'}</strong></div>
    <h3>{promotion.name}</h3><p>ขั้นต่ำ {baht(promotion.minimum_order_amount || 0)}</p>
    {promotion.maximum_discount_amount != null && <p>สูงสุด {baht(promotion.maximum_discount_amount)}</p>}
    {promotion.merchant_id && <p>{merchants.find((store) => String(store.id) === String(promotion.merchant_id))?.store_name || 'สิทธิ์เฉพาะร้าน · ดูรายละเอียด'}</p>}
    {promotion.ends_at && <p>ใช้ได้ถึง {new Date(promotion.ends_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' })}</p>}
    <span className={styles.promotionArrow}><Icon name="arrow" size={18} /></span>
  </Link>;
}
