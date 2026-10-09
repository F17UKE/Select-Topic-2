'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { snapshotChoiceLabel } from '../merchant-snapshot-label';

// The existing menu endpoint is used only to prove an exact local seed tuple.
// Names/prices on the receipt always remain its original order snapshots.
export function OrderSnapshotChoices({ item, merchantId }) {
  const [menu, setMenu] = useState(null);
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development' || !item.menu_item_id) return;
    let active = true;
    api(`/api/menu-items/${item.menu_item_id}`).then(({ menu_item }) => {
      if (active && menu_item.merchant_id === merchantId && menu_item.name === item.item_name) setMenu(menu_item);
    }).catch(() => {});
    return () => { active = false; };
  }, [item.menu_item_id, item.item_name, merchantId]);
  const verified = menu?.merchant_id === merchantId && menu?.id === item.menu_item_id && menu?.name === item.item_name;
  return <p>{item.choices.map((choice) => {
    const group = verified ? menu.option_groups?.find((row) => row.choices.some((option) => option.id === choice.menu_option_choice_id && option.name === choice.choice_name)) : null;
    return snapshotChoiceLabel({ ...item, ...(group ? { local_demo_menu: menu } : {}) },
      { ...choice, ...(group ? { local_demo_group: group.name } : {}) });
  }).join(' · ')}</p>;
}
