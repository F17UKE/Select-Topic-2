'use client';
import { ManagementPage } from '../../../components/merchant-management';
import { DeliveryFees } from '../../../components/merchant-operations';
export default function Page() {
  return <ManagementPage title="ค่าส่ง">{() => <DeliveryFees />}</ManagementPage>;
}
