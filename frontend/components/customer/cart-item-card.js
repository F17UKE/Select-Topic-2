'use client';

import Image from 'next/image';
import Link from 'next/link';
import { baht } from '../../lib/api';
import { Icon } from '../icons';
import { optionChoiceTitle, optionGroupTitle } from './menu-options';
import { CartNoteEditor } from './cart-controls';
import styles from './cart.module.css';

export function cartChoiceLabel(item, choice, development = process.env.NODE_ENV === 'development') {
  const menuItem = { name: item.name, store_name: item.merchantName, image_url: item.imageUrl };
  const group = { name: choice.groupName || '' };
  // Additional exact local seed fixtures sharing Spiciness; Cart display only.
  // Never translate by choice name alone or change the stored cart item.
  const localSpiceDemo = development && group.name === 'Spiciness' && [
    ['Local Kitchen', 'Crispy Pork Basil Rice', '/demo/basil-rice.svg'],
    ['Soi Noodle House', 'Tom Yum Noodles', '/demo/tom-yum-noodles.svg'],
    ['Soi Noodle House', 'Spicy Dry Noodles', '/demo/dry-noodles.svg'],
  ].some(([store, name, image]) => item.merchantName === store && item.name === name && item.imageUrl === image);
  if (localSpiceDemo) {
    const labels = { Mild: 'ไม่เผ็ด', Medium: 'เผ็ดกลาง', Hot: 'เผ็ดมาก' };
    const label = Object.hasOwn(labels, choice.name) ? labels[choice.name] : choice.name;
    return `ระดับความเผ็ด: ${label}${choice.extraPrice ? ` +${baht(choice.extraPrice)}` : ''}`;
  }
  const groupLabel = optionGroupTitle(group, menuItem, development);
  const choiceLabel = optionChoiceTitle(choice, group, menuItem, development);
  return `${groupLabel ? `${groupLabel}: ` : ''}${choiceLabel}${choice.extraPrice ? ` +${baht(choice.extraPrice)}` : ''}`;
}

export function CartItemCard({ item, onQuantityChange, onNoteChange, onRemove }) {
  const unitTotal = item.unitPriceEstimate + item.choices.reduce((sum, choice) => sum + choice.extraPrice, 0);

  return (
    <article className={styles.item}>
      {item.imageUrl ? (
        <div className={styles.thumb}><Image src={item.imageUrl} alt={item.name} fill loading="lazy" sizes="84px" /></div>
      ) : (
        <div className={styles.thumb} aria-hidden="true"><Icon name="cart" size={28} /></div>
      )}
      <div className={styles.copy}>
        <div className={styles.itemTitle}><h2 title={item.name}>{item.name}</h2><div className={styles.price}><strong>{baht(unitTotal * item.quantity)}</strong></div></div>
        {!!item.choices.length && <ul className={styles.options}>{item.choices.map((choice) => <li key={choice.id}>{cartChoiceLabel(item, choice)}</li>)}</ul>}
        {item.quantity > 1 && <p className={styles.unitBreakdown}>{baht(unitTotal)} × {item.quantity}</p>}
      </div>
      <CartNoteEditor item={item} onNoteChange={onNoteChange} />
        <div className={styles.actions}>
          <div className="quantity-control">
            <button type="button" aria-label={`ลดจำนวน ${item.name}`} onClick={() => item.quantity === 1 ? onRemove(item.id) : onQuantityChange(item.id, item.quantity - 1)}><Icon name={item.quantity === 1 ? 'trash' : 'minus'} size={17} /></button>
            <strong>{item.quantity}</strong>
            <button type="button" aria-label={`เพิ่มจำนวน ${item.name}`} disabled={item.quantity >= 99} onClick={() => onQuantityChange(item.id, item.quantity + 1)}><Icon name="plus" size={17} /></button>
          </div>
          <div className={styles.itemLinks}><Link href={`/menu/${item.menuItemId}?cartItem=${item.id}`} aria-label={`แก้ตัวเลือก ${item.name}`}>แก้ตัวเลือก</Link>
          <button type="button" aria-label={`ลบ ${item.name}`} onClick={() => onRemove(item.id)}>ลบ</button></div>
        </div>
    </article>
  );
}
