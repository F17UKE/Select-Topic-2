'use client';
import { ManagementPage } from '../../../components/merchant-management';
import { SalesReports } from '../../../components/merchant-reports';
export default function Page() {
  return (
    <ManagementPage title="รายงาน" roles={['MANAGER', 'CASHIER']}>
      {() => <SalesReports />}
    </ManagementPage>
  );
}
