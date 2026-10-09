'use client';
import { useParams } from 'next/navigation';
import { ManagementPage } from '../../../../components/merchant-management';
import { MenuEditor } from '../../../../components/merchant-catalog';
export default function Page() {
  const { id } = useParams();
  return (
    <ManagementPage title="รายละเอียดเมนู" roles={['MANAGER', 'CASHIER', 'KITCHEN']}>
      {(s) => <MenuEditor id={id} staff={s.staff} />}
    </ManagementPage>
  );
}
