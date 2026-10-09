'use client';
import { AdminContentManager } from '../../../components/admin-content-manager';
import { toLocalInput } from '../../../components/admin-editor';
const fields = [
  { key: 'fundingSource', label: 'ผู้รับผิดชอบส่วนลด', options: ['', 'MERCHANT', 'PLATFORM'], required: true },
  { key: 'name', label: 'ชื่อโปรโมชั่น', required: true },
  { key: 'description', label: 'รายละเอียด', type: 'textarea', nullable: true },
  { key: 'merchantId', label: 'Merchant ID (ว่าง = ทุกร้าน)', type: 'number', nullable: true, min: 1 },
  { key: 'promotionType', label: 'ประเภท', options: ['PERCENTAGE', 'FIXED_AMOUNT', 'FREE_DELIVERY'] },
  { key: 'value', label: 'มูลค่า', type: 'number', step: '0.01', min: 0, required: true },
  { key: 'minimumOrderAmount', label: 'ยอดขั้นต่ำ', type: 'number', step: '0.01', min: 0 },
  { key: 'maximumDiscountAmount', label: 'ส่วนลดสูงสุด', type: 'number', step: '0.01', min: 0, nullable: true },
  { key: 'startsAt', label: 'เริ่ม', type: 'datetime-local', required: true },
  { key: 'endsAt', label: 'สิ้นสุด', type: 'datetime-local', required: true },
  { key: 'usageLimit', label: 'จำนวนสิทธิ์ (ว่าง = ไม่จำกัด)', type: 'number', min: 1, nullable: true },
  { key: 'isActive', label: 'เปิดใช้', type: 'checkbox' },
];
const blank = { fundingSource: '',  name:'', description:'', merchantId:'', promotionType:'PERCENTAGE', value:10, minimumOrderAmount:0, maximumDiscountAmount:'', startsAt:'', endsAt:'', usageLimit:'', isActive:true };
const fromRow = (item) => ({ fundingSource:item.funding_source === 'LEGACY_UNKNOWN' ? '' : item.funding_source, name:item.name, description:item.description ?? '', merchantId:item.merchant_id ?? '', promotionType:item.promotion_type, value:item.value, minimumOrderAmount:item.minimum_order_amount, maximumDiscountAmount:item.maximum_discount_amount ?? '', startsAt:toLocalInput(item.starts_at), endsAt:toLocalInput(item.ends_at), usageLimit:item.usage_limit ?? '', isActive:item.is_active });
export default function Page() { return <AdminContentManager title="โปรโมชั่น · ส่วนลดอัตโนมัติใน Checkout" endpoint="/api/admin/promotions" fields={fields} blank={blank} fromRow={fromRow} statuses={['active','upcoming','expired','disabled']} columns={[{key:'name',label:'ชื่อ'},{key:'promotion_type',label:'ประเภท'},{key:'value',label:'มูลค่า'},{key:'visibility',label:'สถานะ',status:true},{key:'starts_at',label:'เริ่ม',type:'date'},{key:'ends_at',label:'สิ้นสุด',type:'date'},{key:'usage_count',label:'ใช้แล้ว',numeric:true},{key:'usage_limit',label:'สิทธิ์รวม',numeric:true}]} />; }
