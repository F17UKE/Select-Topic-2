'use client';

import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import { adminStatusLabel } from '../lib/admin-presentation.mjs';
import { api } from '../lib/api';
import { AdminShell, AdminError, StatusBadge } from './admin-shell';
import { AdminEditor, AdminPagination } from './admin-editor';
import { AdminDataTable, AdminDialog, AdminRowActions } from './admin-ui';

export function AdminContentManager({ title, endpoint, fields, blank, fromRow, columns, statuses = [], upload = false }) {
  const [data, setData] = useState({ items: [], pagination: {} });
  const [error, setError] = useState('');
  const [editor, setEditor] = useState(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const load = useCallback(() => { setLoading(true); return api(`${endpoint}?${new URLSearchParams({ page: String(page), limit: '20', q: query, status })}`)
    .then((result) => { setData(result); setError(''); }).catch((e) => setError(e.message)).finally(() => setLoading(false)); }, [endpoint, page, query, status]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  return <AdminShell title={title} actions={<button className="admin-secondary" onClick={() => setEditor({ values: { ...blank } })}>เพิ่มรายการ</button>}>
    <AdminError>{error}</AdminError>{notice && <p className="admin-alert" role="status">{notice}</p>}
    <section className="admin-filterbar"><label>ค้นหา<input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} /></label>{statuses.length > 0 && <label>สถานะ<select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">ทั้งหมด</option>{statuses.map((value) => <option key={value} value={value}>{adminStatusLabel(value)}</option>)}</select></label>}</section>
    {editor && <AdminDialog title={editor.id ? 'แก้ไขรายการ' : 'เพิ่มรายการ'} onClose={() => setEditor(null)}><AdminEditor key={editor.id || 'new'} title={editor.id ? 'แก้ไขรายการ' : 'เพิ่มรายการ'} endpoint={`${endpoint}${editor.id ? `/${editor.id}` : ''}`} fields={fields.filter((field) => !editor.id || !field.createOnly)} initial={editor.values} editing={Boolean(editor.id)} upload={upload} onCancel={() => setEditor(null)} onSaved={async () => { setEditor(null); setNotice('บันทึกข้อมูลเรียบร้อยแล้ว'); await load(); }} /></AdminDialog>}
    <section className="admin-table-card"><AdminDataTable loading={loading} items={data.items} columns={upload ? [{ key: '_image', label: 'รูป' }, ...columns] : columns} render={(item, column) => column.key === '_image' ? <Image className="admin-banner-thumb" src={`/api/admin/banners/${item.id}/image`} alt={item.title} width={96} height={48} unoptimized /> : column === columns[0] ? <button className="admin-text-button admin-ellipsis" title={String(item[column.key] ?? '')} onClick={() => setEditor({ id: item.id, values: fromRow(item) })}>{String(item[column.key] ?? '—')}</button> : column.status || column.key === 'role' ? <StatusBadge value={typeof item[column.key] === 'boolean' ? item[column.key] ? 'ACTIVE' : 'INACTIVE' : item[column.key]} /> : column.type === 'date' && item[column.key] ? new Date(item[column.key]).toLocaleString('th-TH') : String(item[column.key] ?? '—')} actions={(item) => <AdminRowActions label={item.title || item.name || item.username || item.id}><button className="admin-secondary" onClick={() => setEditor({ id: item.id, values: fromRow(item) })}>แก้ไข</button></AdminRowActions>} /></section>
    <AdminPagination pagination={data.pagination} onPage={setPage} />
  </AdminShell>;
}
