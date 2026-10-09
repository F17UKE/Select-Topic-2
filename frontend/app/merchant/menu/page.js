'use client';
import { ManagementPage } from '../../../components/merchant-management';
import { MenuList } from '../../../components/merchant-catalog';
export default function Page() {
  return (
    <ManagementPage title="เมนู" roles={['MANAGER', 'CASHIER', 'KITCHEN']}>
      {(s) => <MenuList staff={s.staff} />}
    </ManagementPage>
  );
}
