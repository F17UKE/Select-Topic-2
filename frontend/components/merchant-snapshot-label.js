'use client';
import { cartChoiceLabel } from './customer/cart-item-card';
import { baht } from '../lib/api';

export function snapshotChoiceLabel(item, choice, development = process.env.NODE_ENV === 'development') {
  const demo = item.local_demo_menu;
  if (!development || !demo || demo.name !== item.item_name || !choice.local_demo_group) {
    return `${choice.choice_name}${choice.extra_price ? ` +${baht(choice.extra_price)}` : ''}`;
  }
  return cartChoiceLabel({ name: item.item_name, merchantName: demo.store_name, imageUrl: demo.image_url },
    { name: choice.choice_name, groupName: choice.local_demo_group, extraPrice: choice.extra_price }, development);
}
