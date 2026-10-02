'use client';

import Link from 'next/link';
import { AppShell } from '../../components/app-shell';
import { CartItemCard } from '../../components/customer/cart-item-card';
import { CustomerDetailHeader } from '../../components/customer/detail-header';
import { Icon } from '../../components/icons';
import { baht } from '../../lib/api';
import { useCart } from '../../lib/cart';

export default function CartPage() {
  const { cart, count, estimatedSubtotal, setQuantity, setNote, removeItem, clear } = useCart();
  const detailHeader = <CustomerDetailHeader title="ตะกร้าของฉัน" backHref="/" />;
  if (!cart.items.length) {
    return <AppShell variant="cart" header={detailHeader}><section className="empty-state cart-empty"><span><Icon name="cart" size={38} /></span><h1>ยังไม่มีสินค้าในตะกร้า</h1><p>เลือกเมนูที่อยากทานแล้วกลับมาที่นี่ได้เลย</p><Link className="primary-button inline-link" href="/">เลือกอาหาร</Link></section></AppShell>;
  }

  function clearWithConfirmation() {
    if (window.confirm('ล้างรายการทั้งหมดในตะกร้าหรือไม่?')) clear();
  }

  return (
    <AppShell variant="cart" header={detailHeader}>
      <section className="cart-heading"><div><h1>{cart.merchantName}</h1><p>{count} รายการ</p></div><button type="button" onClick={clearWithConfirmation}><Icon name="trash" size={16} />ล้างตะกร้า</button></section>
      <div className="cart-list">
        {cart.items.map((item) => <CartItemCard item={item} onQuantityChange={setQuantity} onNoteChange={setNote} onRemove={removeItem} key={item.id} />)}
      </div>
      <section className="cart-summary"><div><span>ยอดรวมสินค้า</span><strong>{baht(estimatedSubtotal)}</strong></div><p>ยังไม่รวมค่าจัดส่ง ระบบจะคำนวณในขั้นตอนถัดไป</p><Link className="primary-button checkout-link" href="/checkout">ไปหน้าตรวจสอบออเดอร์</Link></section>
    </AppShell>
  );
}
