'use client';

import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'select-topic-2-cart-v1';
const EMPTY_CART = Object.freeze({ merchantId: null, merchantName: '', items: [] });
let cartSnapshot = EMPTY_CART;
let loaded = false;
const listeners = new Set();

function safeLoad() {
  if (typeof window === 'undefined') return EMPTY_CART;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    if (!parsed || !Number.isInteger(parsed.merchantId) || !Array.isArray(parsed.items)) return EMPTY_CART;
    return parsed;
  } catch {
    return EMPTY_CART;
  }
}

function snapshot() {
  if (!loaded && typeof window !== 'undefined') {
    cartSnapshot = safeLoad();
    loaded = true;
  }
  return cartSnapshot;
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function save(next) {
  cartSnapshot = next.items.length ? next : EMPTY_CART;
  loaded = true;
  if (typeof window !== 'undefined') {
    if (cartSnapshot.items.length) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cartSnapshot));
    else window.localStorage.removeItem(STORAGE_KEY);
  }
  listeners.forEach((listener) => listener());
}

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const cart = useSyncExternalStore(subscribe, snapshot, () => EMPTY_CART);
  const value = useMemo(() => ({
    cart,
    count: cart.items.reduce((sum, item) => sum + item.quantity, 0),
    estimatedSubtotal: cart.items.reduce((sum, item) => sum + (
      item.unitPriceEstimate + item.choices.reduce((choiceSum, choice) => choiceSum + choice.extraPrice, 0)
    ) * item.quantity, 0),
    addOrUpdate(item, editingId = null) {
      const current = snapshot();
      if (current.items.length && current.merchantId !== item.merchantId) {
        const accepted = window.confirm(`ตะกร้ามีอาหารจาก ${current.merchantName} อยู่แล้ว ต้องการล้างตะกร้าและเปลี่ยนร้านหรือไม่?`);
        if (!accepted) return false;
      }
      const base = current.merchantId === item.merchantId ? current.items : [];
      const nextItem = { ...item, id: editingId || globalThis.crypto.randomUUID() };
      save({
        merchantId: item.merchantId,
        merchantName: item.merchantName,
        items: editingId ? base.map((existing) => existing.id === editingId ? nextItem : existing) : [...base, nextItem],
      });
      return true;
    },
    setQuantity(itemId, quantity) {
      const current = snapshot();
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) return;
      save({ ...current, items: current.items.map((item) => item.id === itemId ? { ...item, quantity } : item) });
    },
    setNote(itemId, note) {
      const current = snapshot();
      save({ ...current, items: current.items.map((item) => item.id === itemId ? { ...item, note } : item) });
    },
    removeItem(itemId) {
      const current = snapshot();
      save({ ...current, items: current.items.filter((item) => item.id !== itemId) });
    },
    clear() { save(EMPTY_CART); },
  }), [cart]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used inside CartProvider');
  return context;
}
