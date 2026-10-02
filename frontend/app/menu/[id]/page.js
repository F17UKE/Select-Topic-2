'use client';

import Image from 'next/image';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AppShell, LoadingCards, SignInCard } from '../../../components/app-shell';
import { CustomerDetailHeader } from '../../../components/customer/detail-header';
import { Icon } from '../../../components/icons';
import { api, baht } from '../../../lib/api';
import { useCart } from '../../../lib/cart';
import { useCustomer } from '../../../lib/use-customer';

function optionRuleLabel(group) {
  if (group.is_required && group.min_choices === 1 && group.max_choices === 1) return 'จำเป็น · เลือก 1';
  if (group.is_required && group.min_choices === group.max_choices) return `จำเป็น · เลือก ${group.max_choices}`;
  if (group.is_required) return `จำเป็น · อย่างน้อย ${group.min_choices} · สูงสุด ${group.max_choices}`;
  if (group.max_choices === 1) return 'เลือกได้ 1';
  return `เลือกได้สูงสุด ${group.max_choices}`;
}

export default function MenuDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const session = useCustomer();
  const { cart, addOrUpdate } = useCart();
  const editingId = searchParams.get('cartItem');
  const [item, setItem] = useState(null);
  const [selected, setSelected] = useState({});
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    if (!session.customer) return;
    let active = true;
    api(`/api/menu-items/${id}`).then((result) => {
      if (!active) return;
      const loadedItem = result.menu_item;
      setItem(loadedItem);
      const editingItem = editingId ? cart.items.find((cartItem) => cartItem.id === editingId) : null;
      if (editingItem && editingItem.menuItemId === loadedItem.id) {
        const grouped = {};
        for (const group of loadedItem.option_groups) {
          grouped[group.id] = editingItem.optionChoiceIds.filter((choiceId) => group.choices.some((choice) => choice.id === choiceId));
        }
        setSelected(grouped);
        setQuantity(editingItem.quantity);
        setNote(editingItem.note || '');
      }
    }).catch((requestError) => { if (active) setError(requestError.message); });
    return () => { active = false; };
  }, [id, session.customer, editingId, cart.items]);

  const selectedChoices = useMemo(() => {
    if (!item) return [];
    const choiceIds = new Set(Object.values(selected).flat());
    return item.option_groups.flatMap((group) => group.choices.map((choice) => ({ ...choice, groupId: group.id, groupName: group.name })))
      .filter((choice) => choiceIds.has(choice.id));
  }, [item, selected]);
  const unitEstimate = (item?.price || 0) + selectedChoices.reduce((sum, choice) => sum + choice.extra_price, 0);
  const previewTotal = unitEstimate * quantity;

  function toggleChoice(group, choiceId) {
    setActionError('');
    setSelected((current) => {
      const active = current[group.id] || [];
      if (group.max_choices === 1) return { ...current, [group.id]: [choiceId] };
      if (active.includes(choiceId)) return { ...current, [group.id]: active.filter((idValue) => idValue !== choiceId) };
      if (active.length >= group.max_choices) return current;
      return { ...current, [group.id]: [...active, choiceId] };
    });
  }

  function submitCart() {
    const invalidGroup = item.option_groups.find((group) => {
      const count = (selected[group.id] || []).length;
      return count < group.min_choices || count > group.max_choices;
    });
    if (invalidGroup) {
      setActionError(`กรุณาเลือก ${invalidGroup.name} ให้ครบ ${invalidGroup.min_choices}-${invalidGroup.max_choices} ตัวเลือก`);
      return;
    }
    const added = addOrUpdate({
      merchantId: item.merchant_id,
      merchantName: item.store_name,
      menuItemId: item.id,
      name: item.name,
      imageUrl: item.image_url,
      unitPriceEstimate: item.price,
      quantity,
      optionChoiceIds: selectedChoices.map((choice) => choice.id),
      choices: selectedChoices.map((choice) => ({
        id: choice.id, name: choice.name, extraPrice: choice.extra_price, groupId: choice.groupId, groupName: choice.groupName,
      })),
      note: note.trim(),
    }, editingId);
    if (added) router.push('/cart');
  }

  const detailHeader = <CustomerDetailHeader title={editingId ? 'แก้ไขรายการ' : 'รายละเอียดเมนู'} backHref={item ? `/stores/${item.merchant_id}` : '/'} />;
  if (session.loading || (session.customer && !item && !error)) return <AppShell variant="customer-detail" header={detailHeader}><LoadingCards /></AppShell>;
  if (!session.customer) return <AppShell variant="customer-detail" header={detailHeader}><SignInCard config={session.authConfig} loading={session.loading} error={session.error} onLogin={session.devLogin} /></AppShell>;
  if (error) return <AppShell variant="customer-detail" header={detailHeader}><div className="empty-state"><h1>ไม่พบเมนูนี้</h1><p>{error}</p></div></AppShell>;

  const optionSelectionIsValid = item.option_groups.every((group) => {
    const count = (selected[group.id] || []).length;
    return count >= group.min_choices && count <= group.max_choices;
  });
  const stockLimit = item.stock_quantity === null ? 99 : Math.min(99, item.stock_quantity);
  const canOrder = item.is_available && quantity <= stockLimit && optionSelectionIsValid;
  return (
    <AppShell variant="menu-detail" header={detailHeader}>
      {item.image_url ? <div className="menu-detail-image"><Image src={item.image_url} alt={item.name} fill priority sizes="(max-width: 720px) 100vw, 680px" /></div> : <div className="menu-detail-image menu-image-fallback"><Icon name="cart" size={42} /><span>ยังไม่มีรูปเมนู</span></div>}
      <section className="menu-detail-copy">
        <p className="menu-breadcrumb">{item.store_name} · {item.category_name}</p>
        <h1>{item.name}</h1>
        <p>{item.description}</p>
        <strong>{baht(item.price)}</strong>
        {!item.is_available && <div className="notice">เมนูนี้หมดชั่วคราว</div>}
      </section>
      <div className="option-groups">
        {item.option_groups.map((group) => (
          <fieldset className="option-card" key={group.id}>
            <legend><span>{group.name}</span><small>{optionRuleLabel(group)}</small></legend>
            {group.choices.map((choice) => {
              const checked = (selected[group.id] || []).includes(choice.id);
              return <label className={!choice.is_available ? 'disabled' : ''} key={choice.id}><input type={group.max_choices === 1 ? 'radio' : 'checkbox'} name={`group-${group.id}`} checked={checked} disabled={!choice.is_available} onChange={() => toggleChoice(group, choice.id)} /><span>{choice.name}{!choice.is_available && ' · หมด'}</span><strong>{choice.extra_price ? `+${baht(choice.extra_price)}` : 'ไม่เพิ่มราคา'}</strong></label>;
            })}
          </fieldset>
        ))}
      </div>
      <section className="item-customize-card">
        <div className="quantity-row"><div><span>จำนวน</span><small>{item.stock_quantity === null ? 'มีสินค้า' : `เหลือ ${item.stock_quantity}`}</small></div><div className="quantity-control"><button type="button" aria-label="ลดจำนวน" disabled={quantity <= 1} onClick={() => setQuantity((value) => Math.max(1, value - 1))}><Icon name="minus" size={18} /></button><strong>{quantity}</strong><button type="button" aria-label="เพิ่มจำนวน" disabled={quantity >= stockLimit} onClick={() => setQuantity((value) => Math.min(stockLimit, value + 1))}><Icon name="plus" size={18} /></button></div></div>
        <label>หมายเหตุถึงร้าน<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={3} placeholder="เช่น ไม่ใส่ผัก แยกน้ำ" /></label>
      </section>
      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      <section className="preview-bar"><div><span>รวม · {quantity} รายการ</span><strong>{baht(previewTotal)}</strong></div><button type="button" disabled={!canOrder} onClick={submitCart}>{editingId ? 'บันทึกการแก้ไข' : 'เพิ่มลงตะกร้า'}</button></section>
    </AppShell>
  );
}
