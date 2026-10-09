'use client';
import Image from 'next/image';
import { useState } from 'react';
import { managementApi, useManagement } from './merchant-management';
export function Editor({ fields, initial = {}, onSave, submitLabel = 'บันทึก', children }) {
  const [values, setValues] = useState(initial),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await onSave(values);
      setValues((current) => ({ ...current, ...(current.password !== undefined ? { password: '' } : {}) }));
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="management-form" onSubmit={submit}>
      {fields.map((f) => (
        <label key={f.key}>
          {f.label}
          {f.options ? (
            <select
              value={values[f.key] ?? ''}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              required={f.required}
            >
              <option value="">เลือก</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : f.type === 'checkbox' ? (
            <input
              type="checkbox"
              checked={!!values[f.key]}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.checked })}
            />
          ) : (
            <input
              type={f.type || 'text'}
              value={values[f.key] ?? ''}
              min={f.min}
              step={f.step}
              required={f.required}
              autoComplete={f.type === 'password' ? 'new-password' : undefined}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
            />
          )}
        </label>
      ))}
      {children}
      {error && <p role="alert">{error}</p>}
      {saved && <p role="status">บันทึกแล้ว</p>}
      <button type="submit" disabled={busy}>
        {busy ? 'กำลังบันทึก…' : submitLabel}
      </button>
    </form>
  );
}
export function ImageUpload({ namespace, onUploaded }) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <label className="management-form">
      อัปโหลด PNG/JPEG/WebP (ไม่เกิน 5 MB)
      <small>{namespace === 'menu' ? 'แนะนำ 1000 × 1000 px · 1:1 · JPG, PNG หรือ WebP' : 'รูปปก / แกลเลอรี แนะนำ 1200 × 800 px · 3:2 · JPG, PNG หรือ WebP'}</small>
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={busy}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          setError('');
          try {
            const form = new FormData();
            form.append('image', file);
            const result = await managementApi(`/images/${namespace}`, 'POST', form);
            await onUploaded(result.image_url);
          } catch (err) {
            setError(err.message);
          } finally {
            setBusy(false);
            e.target.value = '';
          }
        }}
      />
      {error && <span role="alert">{error}</span>}
    </label>
  );
}
export function StoreSettings() {
  const { data, error, reload } = useManagement('/store');
  const [actionError, setActionError] = useState('');
  if (!data) return <p role={error ? 'alert' : undefined}>{error || 'กำลังโหลด…'}</p>;
  const run = async (fn) => {
    setActionError('');
    try {
      await fn();
      reload();
    } catch (e) {
      setActionError(e.message);
    }
  };
  const days = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  return (
    <>
      <Editor
        key={data.store.updated_at}
        initial={data.store}
        fields={[
          { key: 'store_name', label: 'ชื่อร้าน', required: true },
          { key: 'phone', label: 'เบอร์โทร', required: true },
          { key: 'location_text', label: 'ที่ตั้ง', required: true },
          { key: 'is_open', label: 'เปิดร้านด้วยตนเอง', type: 'checkbox' },
        ]}
        onSave={async (values) => {
          await managementApi('/store', 'PATCH', {
            store_name: values.store_name,
            phone: values.phone,
            location_text: values.location_text,
            is_open: values.is_open,
          });
          reload();
        }}
      />
      <h2>PromptPay</h2>
      <p>
        ปัจจุบัน: {data.store.promptpay_identifier_type} · {data.store.promptpay_masked}
      </p>
      <p className="management-help">เปลี่ยนได้เมื่อไม่มีออเดอร์ค้างชำระที่ยังไม่สิ้นสุด</p>
      <Editor
        initial={{ promptpay_identifier_type: data.store.promptpay_identifier_type }}
        fields={[
          {
            key: 'promptpay_identifier_type',
            label: 'ชนิดบัญชี',
            options: ['PHONE', 'NATIONAL_ID', 'TAX_ID', 'EWALLET'].map((v) => ({ value: v, label: v })),
            required: true,
          },
          { key: 'promptpay_id', label: 'หมายเลขใหม่', required: true },
        ]}
        onSave={async (values) => {
          await managementApi('/store', 'PATCH', values);
          reload();
        }}
      />
      <h2>เวลาเปิดร้าน</h2>
      <p className="management-help">
        เวลาไทย · ไม่มีตารางจะใช้สวิตช์เปิดร้านเดิม · สวิตช์ปิดร้านมีผลเหนือเวลา
      </p>
      <HoursEditor
        key={JSON.stringify(data.hours)}
        hours={data.hours}
        days={days}
        onSave={async (hours) => {
          await managementApi('/store/hours', 'PUT', { hours });
          reload();
        }}
      />
      <h2>รูปภาพร้าน</h2>
      <ImageUpload
        namespace="merchant"
        onUploaded={(url) =>
          run(() =>
            managementApi('/store/gallery', 'POST', { image_url: url, sort_order: data.gallery.length }),
          )
        }
      />
      {actionError && <p role="alert">{actionError}</p>}
      {data.gallery.map((img, index) => (
        <div className="management-row" key={img.id}>
          <Image
            width={160}
            height={107}
            style={{ objectFit: 'contain', width: 160, height: 107 }}
            unoptimized
            src={img.image_url}
            alt={img.alt_text || 'รูปภาพร้าน'}
          />
          <p>{img.is_primary ? 'รูปหลัก' : ''}</p>
          <div className="management-toolbar">
            <button
              className="management-button"
              onClick={() =>
                run(() => managementApi(`/store/gallery/${img.id}`, 'PATCH', { is_primary: true }))
              }
            >
              ตั้งเป็นรูปหลัก
            </button>
            <button
              className="management-button"
              disabled={index === 0}
              onClick={() =>
                run(async () => {
                  await managementApi(`/store/gallery/${img.id}`, 'PATCH', { sort_order: index - 1 });
                  await managementApi(`/store/gallery/${data.gallery[index - 1].id}`, 'PATCH', {
                    sort_order: index,
                  });
                })
              }
            >
              ขึ้น
            </button>
            <button
              className="management-button"
              onClick={() => run(() => managementApi(`/store/gallery/${img.id}`, 'DELETE'))}
            >
              นำรูปออก
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
function HoursEditor({ hours, days, onSave }) {
  const [rows, setRows] = useState(
    days.map((_, i) => {
      const h = hours.find((h) => h.day_of_week === i);
      return {
        day_of_week: i,
        is_closed: h?.is_closed ?? false,
        open_time: h?.open_time?.slice(0, 5) || '09:00',
        close_time: h?.close_time?.slice(0, 5) || '20:00',
      };
    }),
  );
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function save(values) {
    setBusy(true);
    setError('');
    try {
      await onSave(values);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="management-form"
      onSubmit={(e) => {
        e.preventDefault();
        save(rows);
      }}
    >
      {rows.map((r, i) => (
        <fieldset key={i}>
          <legend>{days[i]}</legend>
          <label>
            <input
              type="checkbox"
              checked={r.is_closed}
              onChange={(e) =>
                setRows(rows.map((row, j) => (j === i ? { ...row, is_closed: e.target.checked } : row)))
              }
            />
            ปิดทั้งวัน
          </label>
          {['open_time', 'close_time'].map((k) => (
            <label key={k}>
              {k === 'open_time' ? 'เปิด' : 'ปิด'}
              <input
                type="time"
                value={r[k]}
                disabled={r.is_closed}
                onChange={(e) =>
                  setRows(rows.map((row, j) => (j === i ? { ...row, [k]: e.target.value } : row)))
                }
              />
            </label>
          ))}
        </fieldset>
      ))}
      {error && <p role="alert">{error}</p>}
      <button disabled={busy} type="submit">
        บันทึกเวลา
      </button>
      <button disabled={busy} type="button" onClick={() => save([])}>
        ไม่ใช้ตารางเวลา
      </button>
    </form>
  );
}
