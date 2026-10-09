'use client';
import { AdminShell } from '../../../components/admin-shell';
import { FinancePanel } from '../../../components/finance-panel';
import { useAdmin } from '../../../lib/use-admin';
export default function Page() {
  const session=useAdmin();
  return <AdminShell title="การเงิน" description="บัญชี Platform · ร้านค้า · การจ่ายเงิน">
    {session.admin&&['SUPER_ADMIN','FINANCE'].includes(session.admin.role)?<FinancePanel admin owner={session.admin.role==='SUPER_ADMIN'} mutate={session.mutate}/>:null}
  </AdminShell>;
}
