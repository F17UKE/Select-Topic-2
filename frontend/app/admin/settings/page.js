'use client';

import { useCallback, useEffect, useState } from 'react';
import { AdminError, AdminShell } from '../../../components/admin-shell';
import { api } from '../../../lib/api';
import { useAdmin } from '../../../lib/use-admin';

export default function SettingsPage() {
  const session = useAdmin();
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const labels = { platform_display_name: 'ชื่อแพลตฟอร์ม', support_contact: 'ช่องทางติดต่อฝ่ายช่วยเหลือ', default_banner_fallback: 'แบนเนอร์เริ่มต้น', maintenance_message: 'ข้อความแจ้งบำรุงรักษา', safe_feature_flags: 'ตัวเลือกการแสดงผล' };
  const [settingKey, setSettingKey] = useState('platform_display_name');
  const load = useCallback(() => api('/api/admin/settings')
    .then((result) => setItems(result.settings))
    .catch((requestError) => setError(requestError.message)), []);

  useEffect(() => {
    const request = Promise.resolve().then(load);
    return () => { void request; };
  }, [load]);

  async function save(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await session.mutate(`/api/admin/settings/${settingKey}`, {
        method: 'PUT', body: JSON.stringify({ value: settingKey === 'safe_feature_flags' ? JSON.parse(value) : value, isPublic: true }),
      });
      setValue(''); setNotice('บันทึกการตั้งค่าเรียบร้อยแล้ว');
      await load();
    } catch (requestError) { setError(requestError instanceof SyntaxError ? 'รูปแบบ JSON ไม่ถูกต้อง กรุณาตรวจสอบค่าใหม่' : requestError.message); } finally { setBusy(false); }
  }

  return <AdminShell title="ตั้งค่าทั่วไป" description="ค่าทั่วไปของระบบ · จัดการ provider และ secret ที่เมนูการเชื่อมต่อระบบ">
    <AdminError>{error}</AdminError>{notice && <p role="status" className="admin-alert">{notice}</p>}
    <form className="admin-inline-form" onSubmit={save}>
      <select aria-label="ค่าที่ต้องการแก้ไข" value={settingKey} onChange={(e) => setSettingKey(e.target.value)}>{['platform_display_name','support_contact','default_banner_fallback','maintenance_message','safe_feature_flags'].map(key=><option key={key} value={key}>{labels[key]}</option>)}</select>
      <input aria-label="ค่าใหม่" value={value} onChange={(event) => setValue(event.target.value)} placeholder={settingKey === 'safe_feature_flags' ? '{"example":false}' : 'ค่าใหม่'} required />
      <button disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
    </form>
    <section className="admin-panel"><dl>{items.map((item) => <div key={item.id}><dt>{labels[item.setting_key] || item.setting_key}</dt><dd>{JSON.stringify(item.setting_value)}</dd></div>)}</dl></section>
  </AdminShell>;
}
