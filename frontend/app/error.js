'use client';

import { AppShell } from '../components/app-shell';

export default function ErrorPage({ reset }) {
  return <AppShell><section className="empty-state"><h1>เปิดหน้านี้ไม่สำเร็จ</h1><p>ลองโหลดข้อมูลอีกครั้ง</p><button className="primary-button" type="button" onClick={reset}>ลองใหม่</button></section></AppShell>;
}
