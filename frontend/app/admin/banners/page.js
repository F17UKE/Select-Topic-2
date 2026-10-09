'use client';
import { AdminContentManager } from '../../../components/admin-content-manager';
import { toLocalInput } from '../../../components/admin-editor';

const fields = [
  { key: 'title', label: 'ชื่อแบนเนอร์', required: true },
  { key: 'scope', label: 'ขอบเขต', options: ['GLOBAL', 'MERCHANT'] },
  { key: 'merchantId', label: 'Merchant ID (เฉพาะร้าน)', type: 'number', nullable: true, min: 1 },
  { key: 'targetType', label: 'ปลายทาง', options: ['NONE', 'STORE', 'MENU', 'URL', 'PROMOTION'] },
  { key: 'targetValue', label: 'ID หรือ HTTPS URL ของปลายทาง', nullable: true },
  { key: 'status', label: 'สถานะ', options: ['DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED'] },
  { key: 'startsAt', label: 'เริ่มแสดง', type: 'datetime-local', nullable: true },
  { key: 'endsAt', label: 'สิ้นสุด', type: 'datetime-local', nullable: true },
  { key: 'sortOrder', label: 'ลำดับ (น้อยขึ้นก่อน)', type: 'number', min: 0 },
];
const blank = { title: '', scope: 'GLOBAL', merchantId: '', targetType: 'NONE', targetValue: '', status: 'DRAFT', startsAt: '', endsAt: '', sortOrder: 0 };
const fromRow = (item) => ({ title: item.title, imageObjectKey: item.image_object_key, scope: item.scope, merchantId: item.merchant_id ?? '', targetType: item.target_type, targetValue: item.target_value ?? '', status: item.status, startsAt: toLocalInput(item.starts_at), endsAt: toLocalInput(item.ends_at), sortOrder: item.sort_order });
export default function Page() {
  return <AdminContentManager title="แบนเนอร์" endpoint="/api/admin/banners" upload fields={fields} blank={blank} fromRow={fromRow} statuses={['DRAFT','SCHEDULED','PUBLISHED','ARCHIVED']} columns={[{key:'title',label:'ชื่อ'},{key:'scope',label:'ขอบเขต'},{key:'status',label:'สถานะ',status:true},{key:'starts_at',label:'เริ่ม',type:'date'},{key:'ends_at',label:'สิ้นสุด',type:'date'},{key:'sort_order',label:'ลำดับ',numeric:true}]} />;
}
