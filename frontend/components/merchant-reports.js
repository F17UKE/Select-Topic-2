'use client';
import { useState } from 'react';
import Link from 'next/link';
import { baht } from '../lib/api';
import { useManagement } from './merchant-management';
export function OrderHistory() {
  const [filters, setFilters] = useState({ search: '', date: '', status: '', payment_status: '' }),
    [page, setPage] = useState(1);
  const { data, error } = useManagement(
    `/history?${new URLSearchParams({ ...filters, page: String(page) })}`,
  );
  return (
    <>
      <div className="management-toolbar">
        {[
          { key: 'search', label: 'รหัสออเดอร์' },
          { key: 'date', label: 'วันที่', type: 'date' },
        ].map((f) => (
          <label key={f.key}>
            {f.label}
            <input
              type={f.type || 'text'}
              value={filters[f.key]}
              onChange={(e) => {
                setFilters({ ...filters, [f.key]: e.target.value });
                setPage(1);
              }}
            />
          </label>
        ))}
        {[
          [
            'status',
            'สถานะ',
            ['PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERING', 'COMPLETED', 'REJECTED', 'CANCELLED'],
          ],
          ['payment_status', 'ชำระเงิน', ['UNPAID', 'PENDING_VERIFICATION', 'PAID', 'FAILED']],
        ].map(([key, label, options]) => (
          <label key={key}>
            {label}
            <select
              value={filters[key]}
              onChange={(e) => {
                setFilters({ ...filters, [key]: e.target.value });
                setPage(1);
              }}
            >
              <option value="">ทั้งหมด</option>
              {options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="management-table">
        <table>
          <thead>
            <tr>
              {['รหัส', 'ลูกค้า', 'ยอดรวม', 'สถานะ', 'ชำระเงิน', 'สร้าง / สำเร็จ'].map((t) => (
                <th key={t}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.items.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link href={`/merchant/orders/${o.id}`}>{o.order_code}</Link>
                </td>
                <td>{o.customer_name}</td>
                <td>{baht(o.total_amount)}</td>
                <td>{o.status}</td>
                <td>{o.payment_status}</td>
                <td>
                  {new Date(o.created_at).toLocaleString('th-TH')}
                  <br />
                  {o.completed_at ? new Date(o.completed_at).toLocaleString('th-TH') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>{data?.pagination.total ?? 0} รายการ</p>
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

export function SalesReports() {
  const [days, setDays] = useState('1');
  const { data, error } = useManagement(`/reports?days=${days}`);
  return (
    <>
      <div className="management-toolbar">
        <label>
          ช่วงเวลา
          <select value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="1">วันนี้</option>
            <option value="7">7 วัน</option>
            <option value="30">30 วัน</option>
          </select>
        </label>
      </div>
      <p className="management-help">
        เวลาไทย · นับตามวันที่สร้างออเดอร์ · ยอดขาย/ค่าเฉลี่ยเฉพาะ COMPLETED + PAID รวมค่าส่ง หักส่วนลดแล้ว ·
        เมนู/ตัวเลือกใช้ snapshot
      </p>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <div className="management-kpis">
            {[
              ['orders', 'ออเดอร์'],
              ['completed', 'สำเร็จ'],
              ['revenue', 'ยอดขาย'],
              ['average_order_value', 'เฉลี่ยต่อออเดอร์'],
            ].map(([key, label]) => (
              <article key={key}>
                <span>{label}</span>
                <strong>
                  {['revenue', 'average_order_value'].includes(key)
                    ? baht(data.summary[key])
                    : data.summary[key]}
                </strong>
              </article>
            ))}
          </div>
          <h2>รายวัน</h2>
          <div className="management-table">
            <table>
              <thead>
                <tr>
                  <th>วัน</th>
                  <th>ออเดอร์</th>
                  <th>สำเร็จ</th>
                  <th>ยอดขาย</th>
                </tr>
              </thead>
              <tbody>
                {data.by_day.map((row) => (
                  <tr key={row.day}>
                    <td>{row.day}</td>
                    <td>{row.orders}</td>
                    <td>{row.completed}</td>
                    <td>{baht(row.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>สถานะออเดอร์</h2>
          {data.status.map((row) => (
            <p key={row.status}>
              {row.status} · {row.count}
            </p>
          ))}
          <h2>เมนูขายดี</h2>
          {data.best.map((row) => (
            <p key={row.item_name}>
              {row.item_name} · {row.quantity}
            </p>
          ))}
          {data.options.length > 0 && (
            <>
              <h2>ตัวเลือกยอดนิยม</h2>
              {data.options.map((row) => (
                <p key={row.choice_name}>
                  {row.choice_name} · {row.quantity}
                </p>
              ))}
            </>
          )}
        </>
      )}
    </>
  );
}
