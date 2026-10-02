import Link from 'next/link';
import { baht } from '../../lib/api';
import { formatOrderDate, orderStatusLabel, statusClass } from '../../lib/order-presentation.mjs';
import { Icon } from '../icons';

export function OrderListCard({ order }) {
  return (
    <Link className="order-card" href={`/orders/${order.id}`}>
      <div className="order-card-top"><span>{order.order_code}</span><Icon name="arrow" size={18} /></div>
      <h2>{order.store_name}</h2>
      <div className="order-card-status-row">
        <span className={`order-status ${statusClass(order.status)}`}>{orderStatusLabel(order.status)}</span>
        <strong>{baht(order.total_amount)}</strong>
      </div>
      <div className="order-card-meta"><span>{order.item_count} รายการ</span><span>{formatOrderDate(order.created_at)}</span></div>
      {!!order.item_names?.length && <small>{order.item_names.join(', ')}</small>}
    </Link>
  );
}
