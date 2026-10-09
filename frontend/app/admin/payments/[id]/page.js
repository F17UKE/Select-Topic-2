'use client';
import { useParams } from 'next/navigation';
import { AdminDetailPage } from '../../../../components/admin-resource-page';
export default function Page() { const { id } = useParams(); return <AdminDetailPage title="รายละเอียดการชำระเงิน" endpoint={`/api/admin/payments/${id}`} backHref="/admin/payments" />; }
