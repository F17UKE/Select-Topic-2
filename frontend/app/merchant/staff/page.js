'use client';
import { ManagementPage } from '../../../components/merchant-management';
import { StaffManager } from '../../../components/merchant-operations';
export default function Page() {
  return <ManagementPage title="พนักงาน">{() => <StaffManager />}</ManagementPage>;
}
