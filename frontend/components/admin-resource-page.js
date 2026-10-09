'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { AdminError, AdminShell, StatusBadge } from './admin-shell';
import { AdminPagination } from './admin-editor';
import { adminDetailSections, adminStatusLabel } from '../lib/admin-presentation.mjs';
import { useAdmin } from '../lib/use-admin';
import { AdminDataTable, AdminDialog, AdminRowActions } from './admin-ui';

function display(value, type) {
  if (value === null || value === undefined || value === '') return '—';
  if (type === 'money') return new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(Number(value));
  if (type === 'date') return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  if (type === 'active' || type === 'open') return <StatusBadge value={type === 'open' ? value ? 'OPEN' : 'CLOSED' : value ? 'ACTIVE' : 'INACTIVE'} />;
  if (type === 'status') return <StatusBadge value={value} />;
  if (typeof value === 'boolean') return value ? 'ใช่' : 'ไม่';
  return String(value);
}

function labelFor(key) {
  const labels = { overview: 'ข้อมูลหลัก', amounts: 'ยอดเงินและการชำระเงิน', delivery: 'ข้อมูลจัดส่ง ณ เวลาสั่ง', timestamps: 'เวลาที่บันทึกในระบบ', technical: 'ข้อมูลอ้างอิง', payments: 'ประวัติการชำระเงิน', subtotal_amount: 'ค่าอาหาร', expected_amount: 'ยอดที่ต้องชำระ', amount_transferred: 'ยอดโอนจริง', transaction_reference: 'เลขอ้างอิง (ปิดบังแล้ว)', provider: 'ผู้ตรวจสอบ', verification_status: 'สถานะการตรวจสอบ', delivery_address_label: 'ชื่อที่อยู่', delivery_dormitory_name: 'หอพัก', delivery_soi_name: 'ซอย', delivery_room_number: 'ห้อง', delivery_contact_phone: 'เบอร์ติดต่อ', delivery_address_detail: 'รายละเอียดที่อยู่', delivery_location_text: 'ที่ตั้ง', rider_name: 'ไรเดอร์', customer_name: 'ลูกค้า', order_type: 'รูปแบบรับอาหาร', merchant: 'ข้อมูลร้านค้า', customer: 'ข้อมูลลูกค้า', order: 'ข้อมูลออเดอร์', payment: 'ข้อมูลการชำระเงิน', gallery: 'รูปภาพร้าน', delivery_fees: 'พื้นที่และค่าจัดส่ง', staff: 'พนักงาน', riders: 'ไรเดอร์', location_text: 'ที่ตั้งร้าน', promptpay_identifier_type: 'ประเภท PromptPay', fee: 'ค่าจัดส่ง', soi_name: 'ซอย', summary: 'สรุปการดำเนินงาน', items: 'รายการอาหารและตัวเลือก', choices: 'ตัวเลือกอาหาร', addresses: 'ที่อยู่', orders: 'ประวัติออเดอร์', verifications: 'ประวัติการตรวจสอบ', slip: 'หลักฐานการชำระเงิน', store_name: 'ชื่อร้าน', display_name: 'ชื่อลูกค้า', full_name: 'ชื่อ', phone: 'เบอร์โทรศัพท์', address: 'ที่อยู่', is_active: 'เปิดใช้งาน', is_open: 'เปิดรับออเดอร์', promptpay_id: 'PromptPay', status: 'สถานะ', payment_status: 'สถานะชำระเงิน', order_code: 'เลขออเดอร์', total_amount: 'ยอดรวม', subtotal: 'ค่าอาหาร', delivery_fee: 'ค่าจัดส่ง', discount_amount: 'ส่วนลด', created_at: 'สร้างเมื่อ', updated_at: 'แก้ไขล่าสุด', completed_at: 'สำเร็จเมื่อ', verified_at: 'ตรวจสอบเมื่อ', role: 'บทบาท', room: 'ห้อง', contact_phone: 'เบอร์ติดต่อ', delivery_note: 'หมายเหตุการจัดส่ง', item_name: 'ชื่ออาหาร ณ เวลาสั่ง', quantity: 'จำนวน', unit_price: 'ราคาต่อหน่วย', note: 'หมายเหตุ', description: 'รายละเอียด', payment_summary: 'สรุปการชำระเงิน', line_linked: 'เชื่อมต่อ LINE', order_count: 'จำนวนออเดอร์', order_total: 'ยอดออเดอร์รวม', paid_total: 'ยอดชำระแล้ว' };
  if (labels[key]) return labels[key];
  return String(key).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function DetailValue({ value, name = 'ข้อมูล' }) {
  if (Array.isArray(value)) return <section className="admin-detail-section"><h2>{labelFor(name)}</h2>{value.length === 0
    ? <p className="admin-detail-empty">ไม่มีข้อมูล</p>
    : <div className="admin-detail-collection">{value.map((item, index) => <DetailValue key={item?.id || `${name}-${index}`} value={item} name={`${name} ${index + 1}`} />)}</div>}</section>;
  if (value && typeof value === 'object') return <section className="admin-detail-section"><h2>{labelFor(name)}</h2><dl>{Object.entries(value).map(([key, item]) => (
    item && typeof item === 'object'
      ? <div className="admin-detail-nested" key={key}><DetailValue value={item} name={key} /></div>
      : <div key={key}><dt>{labelFor(key)}</dt><dd>{display(item, key === 'is_active' ? 'active' : key === 'is_open' ? 'open' : /^(status|payment_status|verification_status)$/.test(key) ? 'status' : /_at$/.test(key) && item ? 'date' : /amount$|^delivery_fee$|^unit_price$|^price$/.test(key) ? 'money' : undefined)}</dd></div>
  ))}</dl></section>;
  return <section className="admin-detail-section"><h2>{labelFor(name)}</h2><span>{display(value)}</span></section>;
}

export function AdminResourcePage({ title, description, endpoint, columns, detailBase, filters = [], extraFilters = [] }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [data, setData] = useState({ items: [], pagination: {} });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [extra, setExtra] = useState({});
  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), limit: '20', ...extra });
    if (query) params.set('q', query);
    if (status) params.set('status', status);
    let active = true;
    Promise.resolve().then(() => { if (active) { setLoading(true); setError(''); } return api(`${endpoint}?${params}`); })
      .then((result) => { if (active) setData(result); })
      .catch((requestError) => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [endpoint, query, status, page, extra]);
  return <AdminShell title={title} description={description}>
    <section className="admin-filterbar"><label>ค้นหา<input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="ค้นหา…" /></label>{filters.length > 0 && <label>สถานะ<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">ทั้งหมด</option>{filters.map((item) => <option key={item} value={item}>{adminStatusLabel(item)}</option>)}</select></label>}{extraFilters.map((field) => <label key={field.key}>{field.label}{field.options ? <select value={extra[field.key] || ''} onChange={(e) => {setExtra({...extra,[field.key]:e.target.value});setPage(1);}}><option value="">ทั้งหมด</option>{field.options.map((option) => <option key={option} value={option}>{adminStatusLabel(option)}</option>)}</select> : <input type={field.type || 'text'} value={extra[field.key] || ''} onChange={(e) => { setExtra({...extra,[field.key]:e.target.value});setPage(1); }} />}</label>)}</section>
    <AdminError>{error}</AdminError>
    <section className="admin-table-card"><AdminDataTable columns={columns} items={data.items} loading={loading} render={(item, column) => {
      const value = display(item[column.key], column.type);
      if (column === columns[0] && detailBase) return <Link className="admin-link admin-identity" href={`${detailBase}/${item.id}`}>{column.key === 'store_name' && <span className="admin-avatar">{String(item.store_name || '').slice(0, 1)}</span>}{value}</Link>;
      if (typeof item[column.key] === 'boolean') return <StatusBadge value={column.key === 'is_open' ? item[column.key] ? 'OPEN' : 'CLOSED' : item[column.key] ? 'ACTIVE' : 'INACTIVE'} />;
      return typeof value === 'string' ? <span className="admin-ellipsis" title={value}>{value}</span> : value;
    }} actions={detailBase ? (item) => <AdminRowActions label={item[columns[0].key]}><Link className="admin-link" href={`${detailBase}/${item.id}`}>ดูรายละเอียด</Link></AdminRowActions> : endpoint.includes('audit-logs') ? (item) => <details><summary>รายละเอียด</summary><pre>{JSON.stringify(item.metadata || {}, null, 2)}</pre></details> : undefined} /></section>
    <AdminPagination pagination={data.pagination} onPage={setPage} />
  </AdminShell>;
}

export function AdminDetailPage({ title, endpoint, backHref, entity, children }) {
  const session = useAdmin();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { api(endpoint).then(setData).catch((requestError) => setError(requestError.message)); }, [endpoint]);
  const record = entity && data?.[entity];
  const sections = data ? adminDetailSections(data, entity) : [];
  const canWrite = record && (entity === 'merchant' ? session.admin?.role === 'SUPER_ADMIN' : ['SUPER_ADMIN','ADMIN'].includes(session.admin?.role));
  async function changeStatus(event) {
    event.preventDefault(); setConfirming(false); setBusy(true); setError('');
    try {
      const target = entity === 'merchant' ? `${endpoint}/${record.is_active ? 'suspend' : 'activate'}` : `${endpoint}/status`;
      await session.mutate(target, { method: entity === 'merchant' ? 'POST' : 'PATCH', body: JSON.stringify({ reason, isActive: !record.is_active }) });
      setData(await api(endpoint)); setReason('');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <AdminShell title={record?.store_name || record?.display_name || title} description={record?.store_name ? title : undefined} actions={<Link className="admin-secondary" href={backHref}>ย้อนกลับ</Link>}><AdminError>{error}</AdminError>{confirming && <AdminDialog title="ยืนยันการเปลี่ยนสถานะ" onClose={() => setConfirming(false)}><p>{record.is_active ? 'ระงับการใช้งานบัญชีนี้ตามสิทธิ์และเงื่อนไขเดิมของระบบ?' : 'เปิดใช้งานบัญชีนี้อีกครั้ง?'}</p><div className="admin-actions"><button className="admin-secondary" onClick={() => setConfirming(false)}>ยกเลิก</button><button className="admin-secondary" disabled={busy} onClick={changeStatus}>ยืนยัน</button></div></AdminDialog>}{canWrite && <form className="admin-inline-form" onSubmit={(event) => { event.preventDefault(); setConfirming(true); }}>{entity === 'merchant' && record.is_active && <input aria-label="เหตุผลระงับร้าน" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผลระงับร้าน (ปิดรับออเดอร์ใหม่)" minLength={3} required />}<button disabled={busy}>{record.is_active ? 'ระงับใช้งาน' : 'เปิดใช้งาน'}</button></form>}{!data ? <div className="admin-empty">กำลังโหลด…</div> : <><nav className="admin-detail-nav" aria-label="ส่วนของรายละเอียด">{entity === 'merchant' && session.admin?.role === 'SUPER_ADMIN' && <a href="#merchant-recipient">การรับชำระเงิน</a>}{sections.map(({key}) => <a key={key} href={`#detail-${key}`}>{labelFor(key)}</a>)}</nav><div className="admin-detail-card">{sections.map(({key, value}) => <div key={key} id={`detail-${key}`}>{key === 'technical' ? <details className="admin-panel"><summary>ข้อมูลอ้างอิงเพิ่มเติม</summary><DetailValue value={value} name={key} /></details> : <DetailValue value={value} name={key} />}</div>)}</div>{children && <div id="merchant-recipient">{children}</div>}</>}</AdminShell>;
}
