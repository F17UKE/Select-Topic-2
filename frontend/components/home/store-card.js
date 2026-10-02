import Image from 'next/image';
import Link from 'next/link';
import { baht } from '../../lib/api';
import { Icon } from '../icons';

const homeImageVariants = {
  '/demo/local-kitchen.svg': '/demo/local-kitchen-2.svg',
  '/demo/noodle-house.svg': '/demo/noodle-house-2.svg',
  '/demo/green-bowl.svg': '/demo/green-bowl-2.svg',
};

export function HomeStoreCard({ merchant, addressId }) {
  const href = `/stores/${merchant.id}${addressId ? `?addressId=${addressId}` : ''}`;
  const delivery = merchant.delivery?.available;
  const homeImage = homeImageVariants[merchant.primary_image] || merchant.primary_image;
  return (
    <Link className="home-store-card" href={href}>
      <div className="home-store-image-wrap">
        {homeImage ? (
          <Image src={homeImage} alt={`ภาพร้าน ${merchant.store_name}`} fill loading="eager" sizes="(max-width: 520px) 38vw, 180px" className="home-store-image" />
        ) : <div className="home-store-image-fallback" aria-hidden="true">S2</div>}
        <span className={`home-store-status ${merchant.is_open ? 'is-open' : 'is-closed'}`}>{merchant.is_open ? 'เปิดอยู่' : 'ปิดชั่วคราว'}</span>
        <span className="home-favorite" aria-hidden="true"><Icon name="heart" size={18} /></span>
      </div>
      <div className="home-store-copy">
        <p className="home-store-kind">ร้านอาหารใกล้คุณ</p>
        <h2>{merchant.store_name}</h2>
        <p className="home-store-location"><Icon name="map" size={15} />{merchant.location_text || 'ดูตำแหน่งร้าน'}</p>
        <div className="home-store-facts">
          <span><Icon name="star" size={15} />ร้านใหม่</span>
          <span><Icon name="clock" size={15} />สอบถามเวลา</span>
        </div>
        <div className="home-delivery-info">
          <span>{delivery ? `ค่าส่ง ${baht(merchant.delivery.fee)}` : 'ยังไม่ครอบคลุมพื้นที่'}</span>
          <small>{merchant.delivery?.soi_name || 'เลือกที่อยู่เพื่อดูค่าส่ง'}</small>
        </div>
      </div>
    </Link>
  );
}
