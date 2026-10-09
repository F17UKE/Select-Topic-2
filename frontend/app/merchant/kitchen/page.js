'use client';
import { KitchenTicket } from '../../../components/kitchen-ticket';
import { staffErrorMessage } from '../../../lib/staff-portal.mjs';

import { useEffect, useState } from 'react';
import { LoadingCards } from '../../../components/app-shell';
import { MerchantShell, MerchantSignIn } from '../../../components/merchant-shell';
import { Icon } from '../../../components/icons';
import { api } from '../../../lib/api';
import { useMerchantStaff } from '../../../lib/use-merchant-staff';

export default function MerchantKitchenPage() {
  const session = useMerchantStaff();
  const [orders, setOrders] = useState([]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!session.staff) return;
    api('/api/merchant/orders')
      .then((result) =>
        setOrders(result.orders.filter((order) => ['ACCEPTED', 'PREPARING'].includes(order.status))),
      )
      .catch((requestError) => setError(staffErrorMessage(requestError)))
      .finally(() => setLoading(false));
  }, [session.staff]);
  if (session.loading)
    return (
      <MerchantShell session={session} staff={session.staff} title="ครัว" showNav={false}>
        <LoadingCards />
      </MerchantShell>
    );
  if (!session.staff)
    return (
      <MerchantShell session={session} staff={session.staff} title="เข้าสู่ระบบร้านค้า" showNav={false}>
        <MerchantSignIn
          config={session.authConfig}
          loading={session.loading}
          error={session.error}
          onLogin={session.login}
        />
      </MerchantShell>
    );
  return (
    <MerchantShell session={session} staff={session.staff} title="ครัว" backHref="/merchant">
      <div className="merchant-page-heading kitchen-heading">
        <div>
          <h1>คิวในครัว</h1>
          <p>
            {session.staff.store_name}
          </p>
        </div>
        <span>{orders.length} ออเดอร์กำลังทำ</span>
      </div>
      {error && <p className="form-error">{error}</p>}
      {loading ? <LoadingCards /> : <div className="kitchen-grid">
        {[...orders].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).map((order) => <KitchenTicket key={order.id}
          order={order} role={session.staff.role} now={now} onUpdated={(updated) => setOrders((current) => current.map((row) => row.id === updated.id ? updated : row).filter((row) => ['ACCEPTED', 'PREPARING'].includes(row.status)))} />)}
      </div>}
      {!loading && !error && orders.length === 0 && (
        <section className="merchant-empty kitchen-empty">
          <span>
            <Icon name="check" size={30} />
          </span>
          <h2>ยังไม่มีออเดอร์ที่ต้องเตรียม</h2>
          <p>ออเดอร์ที่เริ่มเตรียมอาหารแล้วจะปรากฏที่นี่</p>
        </section>
      )}
    </MerchantShell>
  );
}
