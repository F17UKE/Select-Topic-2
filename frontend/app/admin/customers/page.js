'use client';
import { AdminResourcePage } from '../../../components/admin-resource-page';
export default function Page() { return <AdminResourcePage title="ลูกค้า" description="โปรไฟล์ LINE ที่อยู่ และประวัติออเดอร์" endpoint="/api/admin/customers" detailBase="/admin/customers" filters={['active','inactive']} columns={[{key:'display_name',label:'ลูกค้า'},{key:'phone',label:'โทรศัพท์'},{key:'line_linked',label:'LINE'},{key:'is_active',label:'Active'},{key:'address_count',label:'ที่อยู่'},{key:'order_count',label:'ออเดอร์'},{key:'last_order_at',label:'ล่าสุด',type:'date'}]} />; }
