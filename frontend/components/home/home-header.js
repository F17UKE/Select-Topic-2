'use client';

import Link from 'next/link';
import { Icon } from '../icons';

export function HomeHeader({ addresses, addressId, onAddressChange }) {
  return (
    <header className="home-header">
      <div className="home-header-inner">
        <div className="home-location-icon"><Icon name="map" size={20} /></div>
        <div className="home-address-copy">
          <span>จัดส่งที่</span>
          {addresses.length ? (
            <label className="home-address-select">
              <span className="sr-only">เลือกที่อยู่จัดส่ง</span>
              <select value={addressId} onChange={onAddressChange} aria-label="เลือกที่อยู่จัดส่ง">
                {addresses.map((address) => (
                  <option key={address.id} value={address.id}>{address.label} · {address.dormitory_name}</option>
                ))}
              </select>
              <Icon name="chevronDown" size={16} />
            </label>
          ) : <Link href="/profile">เพิ่มที่อยู่จัดส่ง</Link>}
        </div>
        <Link className="home-notification" href="/orders" aria-label="ดูสถานะออเดอร์">
          <Icon name="bell" size={21} />
          <span aria-hidden="true" />
        </Link>
      </div>
    </header>
  );
}
