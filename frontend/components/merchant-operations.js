'use client';
import Link from 'next/link';
import { useState } from 'react';
import { staffOrderStatusLabel } from '../lib/staff-presentation.mjs';
import { Editor } from './merchant-editors';
import { managementApi, useManagement } from './merchant-management';
export function DeliveryFees() {
  const [page, setPage] = useState(1);
  const { data, error, reload } = useManagement(`/delivery-fees?page=${page}`);
  return (
    <>
      <p>ไม่เปิดพื้นที่ส่ง = ไม่รองรับพื้นที่นั้น · ค่าส่ง 0 = ส่งฟรี · ไม่เปลี่ยนค่าส่งในออเดอร์เก่า</p>
      {error && <p role="alert">{error}</p>}
      {data?.items.map((row) => (
        <details className="management-row" key={row.soi_id}>
          <summary>
            {row.name} · {row.fee === null ? 'ไม่เปิดพื้นที่ส่ง' : `฿${row.fee}`}
          </summary>
          <Editor
            key={String(row.fee)}
            initial={{ enabled: row.fee !== null, fee: row.fee ?? 0 }}
            fields={[
              { key: 'enabled', label: 'เปิดพื้นที่ส่ง', type: 'checkbox' },
              { key: 'fee', label: 'ค่าส่ง (บาท)', type: 'number', min: 0, step: '0.01' },
            ]}
            onSave={async (v) => {
              await managementApi(`/delivery-fees/${row.soi_id}`, 'PUT', v);
              reload();
            }}
          />
        </details>
      ))}
      <div className="management-toolbar">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          ก่อนหน้า
        </button>
        <span>หน้า {page}</span>
        <button disabled={!data || page * 20 >= data.pagination.total} onClick={() => setPage(page + 1)}>
          ถัดไป
        </button>
      </div>
    </>
  );
}

export function StaffManager({ riderOnly = false }) {
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(''),
    [editing, setEditing] = useState(null),
    [error, setError] = useState('');
  const {
    data,
    error: loadError,
    reload,
  } = useManagement(
    `/staff?${new URLSearchParams({ page: String(page), search, ...(riderOnly ? { role: 'RIDER' } : {}) })}`,
  );
  const fields = [
    { key: 'username', label: 'ชื่อผู้ใช้', required: true },
    { key: 'full_name', label: 'ชื่อพนักงาน', required: true },
    { key: 'phone', label: 'เบอร์โทร' },
    {
      key: 'role',
      label: 'บทบาท',
      required: true,
      options: (riderOnly ? ['RIDER'] : ['MANAGER', 'CASHIER', 'KITCHEN', 'RIDER']).map((value) => ({
        value,
        label: value,
      })),
    },
    { key: 'is_active', label: 'เปิดใช้งาน', type: 'checkbox' },
    ...(!editing
      ? [
          {
            key: 'password',
            label: 'รหัสผ่าน (12 ตัวอักษรขึ้นไป / ไม่เกิน 72 ไบต์)',
            type: 'password',
            required: true,
          },
        ]
      : []),
  ];
  return (
    <>
      <h2>{editing ? 'แก้ไขบัญชี' : riderOnly ? 'เพิ่มไรเดอร์' : 'เพิ่มพนักงาน'}</h2>
      <Editor
        key={editing?.id || 'new'}
        fields={fields}
        initial={editing || { role: riderOnly ? 'RIDER' : 'CASHIER', is_active: true }}
        onSave={async (values) => {
          const body = Object.fromEntries(fields.map((f) => [f.key, values[f.key] ?? null]));
          await managementApi(editing ? `/staff/${editing.id}` : '/staff', editing ? 'PATCH' : 'POST', body);
          setEditing(null);
          reload();
        }}
      />
      {editing && (
        <>
          <button className="management-button" onClick={() => setEditing(null)}>
            ยกเลิกแก้ไข
          </button>
          <h3>ตั้งรหัสผ่านใหม่</h3>
          <Editor
            key={`password-${editing.id}`}
            fields={[{ key: 'password', label: 'รหัสผ่านใหม่', type: 'password', required: true }]}
            onSave={async (v) => {
              await managementApi(`/staff/${editing.id}`, 'PATCH', v);
              setEditing(null);
              reload();
            }}
          />
        </>
      )}
      <div className="management-toolbar">
        <input
          aria-label="ค้นหาพนักงาน"
          placeholder="ค้นหาชื่อพนักงาน"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>
      {(error || loadError) && <p role="alert">{error || loadError}</p>}
      {data?.items.map((row) => (
        <article className="management-row" key={row.id}>
          <strong>{row.full_name}</strong>
          <p>
            {row.username} · {row.role} · {row.is_active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
          </p>
          <p>{row.phone || 'ไม่มีเบอร์โทร'}</p>
          <div className="management-toolbar">
            <button className="management-button" onClick={() => setEditing(row)}>
              แก้ไข / ตั้งรหัสผ่าน
            </button>
            <button
              className="management-button"
              onClick={async () => {
                try {
                  await managementApi(`/staff/${row.id}`, 'PATCH', { is_active: !row.is_active });
                  setError('');
                  reload();
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              {row.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
            </button>
          </div>
        </article>
      ))}
      <div className="management-toolbar">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          ก่อนหน้า
        </button>
        <span>หน้า {page}</span>
        <button disabled={!data || page * 20 >= data.pagination.total} onClick={() => setPage(page + 1)}>
          ถัดไป
        </button>
      </div>
    </>
  );
}

export function RiderManager() {
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState(null);
  const { data, error } = useManagement(`/riders?page=${page}`);
  return (
    <>
      <p>รายชื่อไรเดอร์และงานที่ได้รับมอบหมายของร้านนี้</p>
      {error && <p role="alert">{error}</p>}
      {data?.items.map((row) => (
        <article className="management-row" key={row.id}>
          <h2>{row.full_name}</h2>
          <p>
            {row.phone || 'ไม่มีเบอร์โทร'} · {{ AVAILABLE: 'ว่าง', BUSY: 'มีงานที่ได้รับมอบหมาย', OFFLINE: 'ปิดใช้งาน' }[row.availability] || 'ไม่ทราบสถานะ'} · สำเร็จวันนี้ {row.completed_today}
          </p>
          {row.jobs.map((job) => (
            <p key={job.id}>
              <Link href={`/merchant/orders/${job.id}`}>{job.order_code}</Link> · {staffOrderStatusLabel(job.status)}
            </p>
          ))}
          <button className="management-button" onClick={() => setSelected(row.id)}>
            ประวัติการจัดส่ง
          </button>
        </article>
      ))}
      <div className="management-toolbar">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          ก่อนหน้า
        </button>
        <span>หน้า {page}</span>
        <button disabled={!data || page * 20 >= data.pagination.total} onClick={() => setPage(page + 1)}>
          ถัดไป
        </button>
      </div>
      {selected && <RiderHistory key={selected} id={selected} />}
      <details className="management-row">
        <summary>จัดการบัญชีไรเดอร์</summary>
        <StaffManager riderOnly />
      </details>
    </>
  );
}
function RiderHistory({ id }) {
  const [page, setPage] = useState(1);
  const { data, error } = useManagement(`/riders/${id}/history?page=${page}`);
  return (
    <section>
      <h2>ประวัติการจัดส่ง</h2>
      {error && <p role="alert">{error}</p>}
      {data?.items.map((row) => (
        <p key={row.id}>
          <Link href={`/merchant/orders/${row.id}`}>{row.order_code}</Link> · {row.status}
        </p>
      ))}
      {data?.items.length === 0 && <p>ยังไม่มีงานจัดส่ง</p>}
      <div className="management-toolbar">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          ก่อนหน้า
        </button>
        <span>หน้า {page}</span>
        <button disabled={!data || page * 20 >= data.pagination.total} onClick={() => setPage(page + 1)}>
          ถัดไป
        </button>
      </div>
    </section>
  );
}
