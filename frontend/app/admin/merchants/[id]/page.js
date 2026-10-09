'use client';
import { useParams } from 'next/navigation';
import AdminMerchantRecipient from '../../../../components/admin-merchant-recipient';
import { AdminDetailPage } from '../../../../components/admin-resource-page';
export default function Page() { const { id } = useParams(); return <AdminDetailPage entity="merchant" title="รายละเอียดร้านค้า" endpoint={`/api/admin/merchants/${id}`} backHref="/admin/merchants"><AdminMerchantRecipient key={id} merchantId={id} /></AdminDetailPage>; }
