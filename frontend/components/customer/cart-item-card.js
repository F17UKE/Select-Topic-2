import Image from 'next/image';
import Link from 'next/link';
import { baht } from '../../lib/api';
import { Icon } from '../icons';

export function CartItemCard({ item, onQuantityChange, onNoteChange, onRemove }) {
  const unitTotal = item.unitPriceEstimate + item.choices.reduce((sum, choice) => sum + choice.extraPrice, 0);

  return (
    <article className="cart-item">
      {item.imageUrl ? (
        <div className="cart-thumb"><Image src={item.imageUrl} alt={item.name} fill loading="eager" sizes="96px" /></div>
      ) : (
        <div className="cart-thumb cart-thumb-fallback" aria-hidden="true"><Icon name="cart" size={28} /></div>
      )}
      <div className="cart-item-copy">
        <div className="cart-item-title"><h2>{item.name}</h2><strong>{baht(unitTotal * item.quantity)}</strong></div>
        <p className="cart-options">{item.choices.length ? item.choices.map((choice) => choice.name).join(' · ') : 'ไม่มีตัวเลือกเพิ่มเติม'}</p>
        <label>หมายเหตุถึงร้าน<textarea value={item.note} onChange={(event) => onNoteChange(item.id, event.target.value)} maxLength={500} rows={2} placeholder="ยังไม่มีหมายเหตุถึงร้าน" /></label>
        <div className="cart-actions">
          <div className="quantity-control">
            <button type="button" aria-label={`ลดจำนวน ${item.name}`} onClick={() => item.quantity === 1 ? onRemove(item.id) : onQuantityChange(item.id, item.quantity - 1)}><Icon name={item.quantity === 1 ? 'trash' : 'minus'} size={17} /></button>
            <strong>{item.quantity}</strong>
            <button type="button" aria-label={`เพิ่มจำนวน ${item.name}`} disabled={item.quantity >= 99} onClick={() => onQuantityChange(item.id, item.quantity + 1)}><Icon name="plus" size={17} /></button>
          </div>
          <Link href={`/menu/${item.menuItemId}?cartItem=${item.id}`}><Icon name="edit" size={16} />แก้ตัวเลือก</Link>
          <button type="button" onClick={() => onRemove(item.id)}><Icon name="trash" size={15} />ลบ</button>
        </div>
      </div>
    </article>
  );
}
