'use client';
import { ManagementPage } from '../../../components/merchant-management';
import { RiderManager } from '../../../components/merchant-operations';
export default function Page() {
  return <ManagementPage title="ไรเดอร์">{() => <RiderManager />}</ManagementPage>;
}
