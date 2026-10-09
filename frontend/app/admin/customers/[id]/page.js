'use client';
import { useParams } from 'next/navigation';
import { AdminDetailPage } from '../../../../components/admin-resource-page';
export default function Page() { const { id } = useParams(); return <AdminDetailPage entity="customer" title="รายละเอียดลูกค้า" endpoint={`/api/admin/customers/${id}`} backHref="/admin/customers" />; }
