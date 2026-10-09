'use client';

import Link from 'next/link';
import { AppShell } from '../../components/app-shell';
import { CartItemCard } from '../../components/customer/cart-item-card';
import { ClearCartButton } from '../../components/customer/cart-controls';
import styles from '../../components/customer/cart.module.css';
import { CustomerDetailHeader } from '../../components/customer/detail-header';
import { Icon } from '../../components/icons';
import { baht } from '../../lib/api';
import { useCart } from '../../lib/cart';

export default function CartPage() {
  const { cart, count, estimatedSubtotal, setQuantity, setNote, removeItem, clear } = useCart();
  const detailHeader = <CustomerDetailHeader title="ตะกร้าของฉัน" backHref="/" />;
  if (!cart.items.length) {
    return <div className={styles.page}><AppShell variant="cart" header={detailHeader}><section className="empty-state cart-empty"><span><Icon name="cart" size={38} /></span><h1>ตะกร้ายังว่าง</h1><p>เลือกเมนูที่ชอบแล้วกลับมาที่นี่ได้เลย</p><Link className="primary-button inline-link" href="/">เลือกอาหาร</Link></section></AppShell></div>;
  }

  return (
    <div className={styles.page}><AppShell variant="cart" header={detailHeader}>
      <section className={styles.heading}><div><h1>{cart.merchantName}</h1><p>{cart.items.length} เมนู · {count} ชิ้น</p></div><div className={styles.headingActions}><ClearCartButton onConfirm={clear} /><Link href={`/stores/${cart.merchantId}`}>+ เพิ่มเมนู</Link></div></section>
      <div className="cart-list">
        {cart.items.map((item) => <CartItemCard item={item} onQuantityChange={setQuantity} onNoteChange={setNote} onRemove={removeItem} key={item.id} />)}
      </div>
      <section className={styles.checkoutBar} aria-label="ยอดรวมและตรวจสอบออเดอร์"><div aria-live="polite" aria-atomic="true"><span>รวมทั้งหมด</span><strong>{baht(estimatedSubtotal)}</strong><small>ยังไม่รวมค่าส่ง</small></div><Link href="/checkout">ตรวจสอบออเดอร์</Link></section>
    </AppShell></div>
  );
}
