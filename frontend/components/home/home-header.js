'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useId, useRef, useState } from 'react';
import { Icon } from '../icons';
import styles from './home.module.css';

export function HomeHeader({ addresses, addressId, onAddressChange, unreadCount = 0, profileImage }) {
  const dialog = useRef(null);
  const titleId = useId();
  const dialogId = useId();
  const [addressOpen, setAddressOpen] = useState(false);
  const [failedAvatar, setFailedAvatar] = useState(null);
  const selected = addresses.find((address) => String(address.id) === String(addressId));

  function openAddresses() {
    dialog.current.showModal();
    setAddressOpen(true);
    dialog.current.querySelector('[aria-pressed="true"]')?.focus();
  }

  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <div className={styles.locationIcon}><Icon name="map" size={21} /></div>
        <div className={styles.address}>
          <span>จัดส่งที่</span>
          {addresses.length ? <button type="button" className={styles.addressSelect} onClick={openAddresses} aria-haspopup="dialog" aria-expanded={addressOpen} aria-controls={dialogId} aria-label={`เลือกที่อยู่จัดส่ง ปัจจุบัน ${selected?.label || ''} ${selected?.dormitory_name || ''}`}>
            <span>{selected ? `${selected.label} · ${selected.dormitory_name}` : 'เลือกที่อยู่จัดส่ง'}</span>
            <Icon name="chevronDown" size={15} />
          </button> : <Link href="/profile">เพิ่มที่อยู่จัดส่ง</Link>}
        </div>
        <nav className={styles.headerActions} aria-label="ทางลัดของฉัน">
          <Link href="/notifications" aria-label={`การแจ้งเตือน${unreadCount ? `ที่ยังไม่อ่าน ${unreadCount} รายการ` : ''}`} title="การแจ้งเตือน"><Icon name="bell" size={21} />{unreadCount > 0 && <span className={styles.notificationBadge} aria-hidden="true">{unreadCount > 9 ? '9+' : unreadCount}</span>}</Link>
          <Link href="/profile" aria-label="โปรไฟล์" title="โปรไฟล์">{profileImage && failedAvatar !== profileImage ? <Image className={styles.profileAvatar} src={profileImage} alt="" width={40} height={40} unoptimized onError={() => setFailedAvatar(profileImage)} /> : <Icon name="user" size={21} />}</Link>
        </nav>
      </div>
      <dialog id={dialogId} ref={dialog} className={styles.addressDialog} aria-labelledby={titleId} onClose={() => setAddressOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) dialog.current.close(); }}>
        <div className={styles.addressPanel}>
          <div className={styles.addressPanelHeading}><h2 id={titleId}>เลือกที่อยู่จัดส่ง</h2><button type="button" onClick={() => dialog.current.close()} aria-label="ปิดตัวเลือกที่อยู่">ปิด</button></div>
          <div className={styles.addressOptions}>
            {addresses.map((address) => <button key={address.id} type="button" aria-pressed={String(address.id) === String(addressId)} onClick={() => { onAddressChange(String(address.id)); dialog.current.close(); }}>
              <Icon name={String(address.id) === String(addressId) ? 'check' : 'map'} size={20} />
              <span><strong>{address.label} · {address.dormitory_name}</strong><small>{address.room_number ? `ห้อง ${address.room_number}` : 'ไม่ระบุห้อง'}{address.is_default ? ' · ที่อยู่หลัก' : ''}</small></span>
            </button>)}
          </div>
          <Link href="/profile" onClick={() => dialog.current.close()}>จัดการที่อยู่</Link>
        </div>
      </dialog>
    </header>
  );
}
