'use client';
import { ManagementPage } from '../../../../components/merchant-management';
import { MenuEditor } from '../../../../components/merchant-catalog';
export default function Page() {
  return <ManagementPage title="เพิ่มเมนู">{(s) => <MenuEditor staff={s.staff} />}</ManagementPage>;
}
