'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { customerErrorMessage } from '../../lib/customer-error.mjs';
import Link from 'next/link';
import { AppShell, LoadingCards, SignInCard } from '../../components/app-shell';
import { CustomerDetailHeader } from '../../components/customer/detail-header';
import { AddressCard, ProfileSummary } from '../../components/customer/profile-cards';
import { Icon } from '../../components/icons';
import { api } from '../../lib/api';
import { useCustomer } from '../../lib/use-customer';

const emptyAddress = { label: '', dormitoryId: '', roomNumber: '', contactPhone: '', addressDetail: '', isDefault: false };

async function fetchProfileData() {
  const [profileResult, addressResult, dormitoryResult] = await Promise.all([
    api('/api/customer/profile'), api('/api/customer/addresses'), api('/api/dormitories'),
  ]);
  return { profileResult, addressResult, dormitoryResult };
}

export default function ProfilePage() {
  const session = useCustomer();
  const [profile, setProfile] = useState({ displayName: '', phone: '' });
  const [addresses, setAddresses] = useState([]);
  const [dormitories, setDormitories] = useState([]);
  const [addressForm, setAddressForm] = useState(emptyAddress);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const addressFormRef = useRef(null);

  const loadProfile = useCallback(async () => {
    const { profileResult, addressResult, dormitoryResult } = await fetchProfileData();
    setProfile({ displayName: profileResult.customer.display_name || '', phone: profileResult.customer.phone || '' });
    setAddresses(addressResult.addresses);
    setDormitories(dormitoryResult.dormitories);
  }, []);

  useEffect(() => {
    if (!session.customer) return;
    let active = true;
    fetchProfileData().then(({ profileResult, addressResult, dormitoryResult }) => {
      if (!active) return;
      setProfile({ displayName: profileResult.customer.display_name || '', phone: profileResult.customer.phone || '' });
      setAddresses(addressResult.addresses);
      setDormitories(dormitoryResult.dormitories);
    }).catch((requestError) => { if (active) setError(customerErrorMessage(requestError)); });
    return () => { active = false; };
  }, [session.customer]);

  async function saveProfile(event) {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api('/api/customer/profile', { method: 'PATCH', body: JSON.stringify(profile) });
      session.setCustomer(result.customer);
      setMessage('บันทึกโปรไฟล์แล้ว');
    } catch (requestError) { setError(customerErrorMessage(requestError)); }
    finally { setBusy(false); }
  }

  function editAddress(address) {
    setEditingId(address.id);
    setAddressForm({
      label: address.label, dormitoryId: String(address.dormitory_id), roomNumber: address.room_number,
      contactPhone: address.contact_phone, addressDetail: address.address_detail || '', isDefault: address.is_default,
    });
    requestAnimationFrame(() => addressFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  async function saveAddress(event) {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      const path = editingId ? `/api/customer/addresses/${editingId}` : '/api/customer/addresses';
      await api(path, { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(addressForm) });
      setAddressForm(emptyAddress); setEditingId(null);
      await loadProfile();
      setMessage(editingId ? 'แก้ไขที่อยู่แล้ว' : 'เพิ่มที่อยู่แล้ว');
    } catch (requestError) { setError(customerErrorMessage(requestError)); }
    finally { setBusy(false); }
  }

  async function setDefault(id) {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api(`/api/customer/addresses/${id}/default`, { method: 'PUT' });
      setAddresses(result.addresses);
      setMessage('เปลี่ยนที่อยู่หลักแล้ว');
    } catch (requestError) { setError(customerErrorMessage(requestError)); }
    finally { setBusy(false); }
  }

  const profileHeader = <CustomerDetailHeader title="โปรไฟล์และที่อยู่" backHref="/" />;
  if (session.loading) return <AppShell variant="profile" header={profileHeader}><LoadingCards /></AppShell>;
  if (!session.customer) return <AppShell variant="profile" header={profileHeader}><SignInCard config={session.authConfig} loading={session.loading} error={session.error} onLogin={session.devLogin} /></AppShell>;

  return (
    <AppShell variant="profile" header={profileHeader}>
      <ProfileSummary customer={session.customer} />
      <nav className="profile-shortcuts" aria-label="ทางลัดบัญชี"><Link href="/favorites"><Icon name="heart" size={20} /><span><strong>ร้านโปรด</strong><small>ร้านที่บันทึกไว้</small></span><Icon name="arrow" size={17} /></Link><Link href="/notifications"><Icon name="bell" size={20} /><span><strong>การแจ้งเตือน</strong><small>อัปเดตสถานะออเดอร์</small></span><Icon name="arrow" size={17} /></Link><Link href="/promotions"><Icon name="receipt" size={20} /><span><strong>โปรโมชัน</strong><small>สิทธิ์ที่ใช้ได้ตอนนี้</small></span><Icon name="arrow" size={17} /></Link></nav>

      <form className="profile-form-card" onSubmit={saveProfile}>
        <div className="profile-card-heading"><div><h2>ข้อมูลส่วนตัว</h2><p>แก้ไขข้อมูลสำหรับการติดต่อ</p></div><span><Icon name="user" size={20} /></span></div>
        <div className="profile-fields">
          <label>ชื่อที่แสดง<input value={profile.displayName} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} maxLength={160} autoComplete="name" required /></label>
          <label>เบอร์โทร<input type="tel" inputMode="tel" value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} minLength={8} maxLength={32} autoComplete="tel" required /></label>
        </div>
        <button className="primary-button" type="submit" disabled={busy}>บันทึกข้อมูล</button>
      </form>

      <section className="profile-section-heading"><div><h2>ที่อยู่ของฉัน</h2><span>{addresses.length} แห่ง</span></div><button type="button" onClick={() => addressFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><Icon name="plus" size={17} />เพิ่มที่อยู่</button></section>
      <div className="profile-address-list">
        {addresses.map((address) => <AddressCard address={address} busy={busy} onEdit={editAddress} onSetDefault={setDefault} key={address.id} />)}
        {!addresses.length && <div className="profile-address-empty"><Icon name="map" /><p>ยังไม่มีที่อยู่สำหรับจัดส่ง</p></div>}
      </div>

      <form className="profile-form-card profile-address-form" onSubmit={saveAddress} ref={addressFormRef}>
        <div className="profile-card-heading"><div><h2>{editingId ? 'แก้ไขที่อยู่' : 'เพิ่มที่อยู่'}</h2><p>{editingId ? 'ปรับข้อมูลสถานที่รับอาหาร' : 'เพิ่มสถานที่สำหรับรับอาหาร'}</p></div><span><Icon name={editingId ? 'edit' : 'plus'} size={20} /></span></div>
        <div className="profile-address-fields">
          <label>ชื่อเรียก<input value={addressForm.label} onChange={(event) => setAddressForm({ ...addressForm, label: event.target.value })} placeholder="เช่น บ้าน, หอพัก, ห้องเพื่อน" maxLength={80} required /></label>
          <label>หอพัก / จุดส่ง<select value={addressForm.dormitoryId} onChange={(event) => setAddressForm({ ...addressForm, dormitoryId: event.target.value })} required><option value="">เลือกหอพัก / จุดส่ง</option>{dormitories.map((dormitory) => <option key={dormitory.id} value={dormitory.id}>{dormitory.name} · {dormitory.soi_name}</option>)}</select></label>
          <label>ห้อง<input value={addressForm.roomNumber} onChange={(event) => setAddressForm({ ...addressForm, roomNumber: event.target.value })} placeholder="เช่น A-101" maxLength={80} required /></label>
          <label>เบอร์ติดต่อ<input type="tel" inputMode="tel" value={addressForm.contactPhone} onChange={(event) => setAddressForm({ ...addressForm, contactPhone: event.target.value })} minLength={8} maxLength={32} autoComplete="tel" required /></label>
        </div>
        <label>รายละเอียดเพิ่มเติม<textarea value={addressForm.addressDetail} onChange={(event) => setAddressForm({ ...addressForm, addressDetail: event.target.value })} placeholder="เช่น จุดสังเกต หรือวิธีติดต่อเมื่อถึง" maxLength={1000} rows={4} /></label>
        {!editingId && <label className="checkbox-row"><input type="checkbox" checked={addressForm.isDefault} onChange={(event) => setAddressForm({ ...addressForm, isDefault: event.target.checked })} />ใช้เป็นที่อยู่เริ่มต้น</label>}
        <div className="profile-form-actions"><button className="primary-button" type="submit" disabled={busy}>{editingId ? 'บันทึกการแก้ไข' : 'เพิ่มที่อยู่'}</button>{editingId && <button className="secondary-button" type="button" onClick={() => { setEditingId(null); setAddressForm(emptyAddress); }}>ยกเลิก</button>}</div>
      </form>
      {message && <div className="toast success" role="status">{message}</div>}
      {error && <div className="toast error" role="alert">{error}</div>}
    </AppShell>
  );
}
