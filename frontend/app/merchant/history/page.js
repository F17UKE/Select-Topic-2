'use client';
import { ManagementPage } from '../../../components/merchant-management';
import { OrderHistory } from '../../../components/merchant-reports';
export default function Page() {
  return (
    <ManagementPage title="ประวัติออเดอร์" roles={['MANAGER', 'CASHIER']}>
      {() => <OrderHistory />}
    </ManagementPage>
  );
}
