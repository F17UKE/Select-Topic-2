import { Icon } from '../icons';

export function ProfileSummary({ customer }) {
  const displayName = customer.display_name || 'ตั้งชื่อของคุณ';
  const avatarStyle = customer.profile_image_url
    ? { backgroundImage: `url("${customer.profile_image_url.replaceAll('"', '%22')}")` }
    : undefined;

  return (
    <section className="profile-summary-card">
      <span
        className={`profile-avatar${customer.profile_image_url ? ' has-image' : ''}`}
        style={avatarStyle}
        role={customer.profile_image_url ? 'img' : undefined}
        aria-label={customer.profile_image_url ? `รูปโปรไฟล์ของ ${displayName}` : undefined}
        aria-hidden={customer.profile_image_url ? undefined : true}
      >
        {!customer.profile_image_url && displayName.slice(0, 1).toUpperCase()}
      </span>
      <div>
        <h1>{displayName}</h1>
        <p className="profile-summary-phone">{customer.phone || 'ยังไม่ได้ระบุเบอร์โทร'}</p>
        <p className="profile-summary-help">ข้อมูลนี้ใช้สำหรับการสั่งและจัดส่งอาหาร</p>
      </div>
    </section>
  );
}

export function AddressCard({ address, busy, onEdit, onSetDefault }) {
  return (
    <article className={`profile-address-card${address.is_default ? ' is-default' : ''}`}>
      <div className="profile-address-title">
        <span className="profile-address-icon"><Icon name="map" size={19} /></span>
        <h3>{address.label}</h3>
        {address.is_default && <span className="profile-default-badge">ค่าเริ่มต้น</span>}
      </div>
      <div className="profile-address-copy">
        <strong>{address.dormitory_name} · ห้อง {address.room_number}</strong>
        <p>{address.soi_name}</p>
        <a href={`tel:${address.contact_phone}`}><Icon name="phone" size={15} />{address.contact_phone}</a>
        {address.address_detail && <p className="profile-address-detail">{address.address_detail}</p>}
      </div>
      <div className="profile-address-actions">
        <button type="button" onClick={() => onEdit(address)}><Icon name="edit" size={16} />แก้ไข</button>
        {!address.is_default && <button type="button" onClick={() => onSetDefault(address.id)} disabled={busy}><Icon name="check" size={16} />ตั้งเป็นค่าเริ่มต้น</button>}
      </div>
    </article>
  );
}
