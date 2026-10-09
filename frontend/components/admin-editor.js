'use client';

import { useState } from 'react';
import { useAdmin } from '../lib/use-admin';
import { AdminError } from './admin-shell';

export function toLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

// Metadata describes display fields only. API validation and authorization remain on the server.
export function AdminEditor({ title, endpoint, fields, initial = {}, onSaved, onCancel, upload = false, editing = false }) {
  const session = useAdmin();
  const [values, setValues] = useState(initial);
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  async function submit(event, confirmed = false) {
    event?.preventDefault();
    if (editing && endpoint.startsWith('/api/admin/users') && (values.role !== initial.role || values.isActive !== initial.isActive) && !confirmed) { setConfirming(true); return; }
    setConfirming(false);
    setSaving(true);
    setError('');
    try {
      const body = {};
      for (const field of fields) {
        const value = values[field.key];
        if (field.omitEmpty && !value) continue;
        body[field.key] = field.type === 'checkbox' ? Boolean(value)
          : field.nullable && (value === '' || value == null) ? null
            : field.type === 'number' ? Number(value)
              : field.type === 'datetime-local' ? (value ? new Date(value).toISOString() : null) : value ?? '';
      }
      if (upload) {
        body.imageObjectKey = initial.imageObjectKey;
        if (file) {
          const form = new FormData(); form.append('image', file);
          const result = await session.mutate('/api/admin/banners/upload', { method: 'POST', body: form });
          body.imageObjectKey = result.object_key;
        }
        if (!body.imageObjectKey) throw new Error('กรุณาเลือกรูปแบนเนอร์');
      }
      await session.mutate(endpoint, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      await onSaved();
    } catch (requestError) { setError(requestError.message); }
    finally { setSaving(false); }
  }
  return <section className="admin-editor"><h2>{title}</h2><AdminError>{error}</AdminError><form className="admin-form-grid" onSubmit={submit}>
    {fields.map((field) => <label key={field.key}>{field.label}{field.options
      ? <select value={values[field.key] ?? ''} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}>{field.options.map((option) => <option key={option.value ?? option} value={option.value ?? option}>{option.label ?? option}</option>)}</select>
      : field.type === 'textarea' ? <textarea value={values[field.key] ?? ''} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} maxLength={field.maxLength || 2000} />
        : <input type={field.type || 'text'} value={field.type === 'checkbox' ? undefined : values[field.key] ?? ''} checked={field.type === 'checkbox' ? Boolean(values[field.key]) : undefined}
          onChange={(event) => setValues({ ...values, [field.key]: field.type === 'checkbox' ? event.target.checked : event.target.value })}
          required={field.required} min={field.min} max={field.max} minLength={field.minLength} maxLength={field.maxLength || 200} step={field.type === 'number' ? field.step || '1' : undefined} autoComplete={field.type === 'password' ? 'new-password' : undefined} />}</label>)}
    {upload && <label>รูปแบนเนอร์<small>แนะนำ 1600 × 720 px · 20:9 · JPG, PNG หรือ WebP</small><input type="file" accept="image/png,image/jpeg,image/webp" required={!initial.imageObjectKey} onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>}
    {confirming && <div className="admin-confirm-inline" role="alert"><strong>ยืนยันการเปลี่ยนสิทธิ์หรือสถานะผู้ดูแลระบบ</strong><p>การเปลี่ยนแปลงนี้มีผลต่อการเข้าถึงระบบของบัญชีนี้</p><button type="button" disabled={saving} onClick={() => submit(null, true)}>ยืนยันการเปลี่ยนแปลง</button> <button type="button" className="admin-secondary" onClick={() => setConfirming(false)}>กลับไปแก้ไข</button></div>}
    <div className="admin-actions"><button disabled={saving || confirming}>{saving ? 'กำลังบันทึก…' : 'บันทึก'}</button> <button className="admin-secondary" type="button" onClick={onCancel}>ยกเลิก</button></div>
  </form></section>;
}

export function AdminPagination({ pagination, onPage }) {
  const { page = 1, limit = 20, total = 0 } = pagination || {};
  return <div className="admin-pagination"><span>ทั้งหมด {total} รายการ · หน้า {page}/{Math.max(1, Math.ceil(total / limit))}</span><div>
    <button className="admin-secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>ก่อนหน้า</button>{' '}
    <button className="admin-secondary" disabled={page * limit >= total} onClick={() => onPage(page + 1)}>ถัดไป</button>
  </div></div>;
}
