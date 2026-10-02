'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell, LoadingCards, SignInCard } from '../components/app-shell';
import { HomeHeader } from '../components/home/home-header';
import { PromoBanner } from '../components/home/promo-banner';
import { HomeStoreCard } from '../components/home/store-card';
import { Icon } from '../components/icons';
import { api } from '../lib/api';
import { useCustomer } from '../lib/use-customer';

export default function HomePage() {
  const { customer, authConfig, loading: authLoading, error: authError, devLogin } = useCustomer();
  const [addresses, setAddresses] = useState([]);
  const [addressId, setAddressId] = useState('');
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [merchants, setMerchants] = useState([]);
  const [loadingStores, setLoadingStores] = useState(false);
  const [storeError, setStoreError] = useState('');

  const loadStores = useCallback(async (nextAddressId, nextQuery) => {
    setLoadingStores(true);
    setStoreError('');
    try {
      const params = new URLSearchParams();
      if (nextAddressId) params.set('addressId', nextAddressId);
      if (nextQuery) params.set('q', nextQuery);
      const result = await api(`/api/merchants?${params}`);
      setMerchants(result.merchants);
    } catch (requestError) {
      setStoreError(requestError.message);
    } finally {
      setLoadingStores(false);
    }
  }, []);

  useEffect(() => {
    if (!customer) return;
    let active = true;
    (async () => {
      try {
        const result = await api('/api/customer/addresses');
        if (!active) return;
        setAddresses(result.addresses);
        const selected = result.addresses.find((address) => address.is_default)?.id || result.addresses[0]?.id || '';
        setAddressId(String(selected));
        await loadStores(selected, '');
      } catch (requestError) {
        if (active) setStoreError(requestError.message);
      }
    })();
    return () => { active = false; };
  }, [customer, loadStores]);

  function submitSearch(event) {
    event.preventDefault();
    const normalized = query.trim();
    setAppliedQuery(normalized);
    loadStores(addressId, normalized);
  }

  function changeAddress(event) {
    const next = event.target.value;
    setAddressId(next);
    loadStores(next, appliedQuery);
  }

  function showAllStores() {
    setQuery('');
    setAppliedQuery('');
    loadStores(addressId, '');
  }

  if (authLoading) return <AppShell><LoadingCards /></AppShell>;
  if (!customer) return <AppShell><SignInCard config={authConfig} loading={authLoading} error={authError} onLogin={devLogin} /></AppShell>;

  return (
    <AppShell variant="home" header={<HomeHeader addresses={addresses} addressId={addressId} onAddressChange={changeAddress} />}>
      <form className="home-search" onSubmit={submitSearch} role="search">
        <Icon name="search" size={21} />
        <label className="sr-only" htmlFor="store-search">ค้นหาร้านหรือเมนู</label>
        <input id="store-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="อยากกินอะไรดี?" maxLength={80} />
        <button type="submit" aria-label="ค้นหาและกรองร้าน"><Icon name="sliders" size={20} /></button>
      </form>

      <PromoBanner />

      <section className="home-store-section" id="recommended-stores">
        <div className="home-section-heading">
          <div>
            <p>ร้านแนะนำสำหรับคุณ</p>
            {appliedQuery && <span>ผลการค้นหา “{appliedQuery}”</span>}
          </div>
          <button type="button" onClick={showAllStores}>ดูทั้งหมด</button>
        </div>
        {storeError && <p className="form-error" role="alert">โหลดร้านไม่สำเร็จ: {storeError}</p>}
        {loadingStores ? <LoadingCards /> : (
          <div className="home-store-grid">
            {merchants.map((merchant) => <HomeStoreCard key={merchant.id} merchant={merchant} addressId={addressId} />)}
            {!merchants.length && !storeError && (
              <div className="empty-state"><Icon name="search" size={34} /><h2>ยังไม่พบร้านหรือเมนูนี้</h2><p>ลองเปลี่ยนคำค้น หรือดูร้านทั้งหมดอีกครั้ง</p></div>
            )}
          </div>
        )}
      </section>
    </AppShell>
  );
}
