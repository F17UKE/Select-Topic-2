'use client';
import { useParams } from 'next/navigation';
import { AdminDetailPage } from '../../../../components/admin-resource-page';
export default function Page() { const { id } = useParams(); return <AdminDetailPage title="รายละเอียดออเดอร์" endpoint={`/api/admin/orders/${id}`} backHref="/admin/orders" />; }
