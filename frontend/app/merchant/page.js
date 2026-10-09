'use client';
import { Dashboard, ManagementPage } from '../../components/merchant-management';
export default function Page() {
  return (
    <ManagementPage title="ภาพรวมร้านค้า" roles={['MANAGER', 'CASHIER', 'KITCHEN']}>
      {(session) => <Dashboard session={session} />}
    </ManagementPage>
  );
}
