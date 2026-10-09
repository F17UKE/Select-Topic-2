'use client';
import { ManagementPage } from '../../../components/merchant-management';
import { StoreSettings } from '../../../components/merchant-editors';
export default function Page() {
  return <ManagementPage title="ตั้งค่าร้าน">{() => <StoreSettings />}</ManagementPage>;
}
