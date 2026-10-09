'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell, LoadingCards, SignInCard } from '../components/app-shell';
import { HomeHeader } from '../components/home/home-header';
import { PromoBanner } from '../components/home/promo-banner';
import { DiscoveryStoreCard } from '../components/home/discovery-store-card';
import { HomeQuickActions } from '../components/home/home-navigation';
import { Icon } from '../components/icons';
import { api } from '../lib/api';
import { useCustomer } from '../lib/use-customer';
import styles from '../components/home/home.module.css';

export default function HomePage() {
  const { customer, authConfig, loading: authLoading, error: authError, devLogin } = useCustomer();
  const [addresses, setAddresses] = useState([]);
  const [addressId, setAddressId] = useState('');
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [merchants, setMerchants] = useState([]);
  const [loadingStores, setLoadingStores] = useState(true);
  const [storeError, setStoreError] = useState('');
  const [banners, setBanners] = useState([]);
  const [loadingBanners, setLoadingBanners] = useState(true);
  const [promotions, setPromotions] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const storeRequest = useRef(0);
  const invalidateRequests = useCallback(() => {
    storeRequest.current++;
  }, []);

  const loadStores = useCallback(async (nextAddressId, nextQuery) => {
    const request = ++storeRequest.current;
    setLoadingStores(true);
    setStoreError('');
    try {
      const params = new URLSearchParams();
      if (nextAddressId) params.set('addressId', nextAddressId);
      if (nextQuery) params.set('q', nextQuery);
      const result = await api(`/api/merchants?${params}`);
      if (request === storeRequest.current) setMerchants(result.merchants);
    } catch (requestError) {
      if (request === storeRequest.current) setStoreError(requestError.message);
    } finally {
      if (request === storeRequest.current) setLoadingStores(false);
    }
  }, []);

  useEffect(() => {
    if (!customer) return;
    let active = true;
    api('/api/customer/addresses').then((result) => {
      if (!active) return;
      setAddresses(result.addresses);
      const selected = result.addresses.find((address) => address.is_default)?.id || result.addresses[0]?.id || '';
      setAddressId(String(selected));
      loadStores(selected, '');
    }).catch((requestError) => { if (active) { setStoreError(requestError.message); setLoadingStores(false); } });
    Promise.allSettled([api('/api/promotions'), api('/api/customer/notifications')]).then((extras) => {
      if (!active) return;
      if (extras[0].status === 'fulfilled') setPromotions(extras[0].value.promotions);
      if (extras[1].status === 'fulfilled') setUnreadCount(extras[1].value.unread_count || 0);
    });
    return () => { active = false; invalidateRequests(); };
  }, [customer, loadStores, invalidateRequests]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const refresh = () => api('/api/banners/active', { signal: controller.signal })
      .then((result) => { if (active) setBanners(result.banners || []); })
      .catch(() => { if (active) setBanners([]); })
      .finally(() => { if (active) setLoadingBanners(false); });
    refresh();
    // Re-check server-controlled publication windows when returning to Home and every minute.
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, 60000);
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { active = false; controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  function submitSearch(event) {
    event.preventDefault();
    const normalized = query.trim();
    setAppliedQuery(normalized);
    loadStores(addressId, normalized);
  }

  function changeAddress(next) {
    setAddressId(next);
    loadStores(next, appliedQuery);
  }

  function showAllStores() {
    setQuery('');
    setAppliedQuery('');
    loadStores(addressId, '');
  }

  function favoriteChanged(merchant, favorite) {
    setMerchants((current) => current.map((item) => String(item.id) === String(merchant.id) ? { ...item, is_favorite: favorite } : item));
  }

  const renderStore = (merchant) => <DiscoveryStoreCard key={merchant.id} merchant={merchant} addressId={addressId} onFavoriteChange={favoriteChanged} promotion={promotions.find((item) => item.merchant_id && String(item.merchant_id) === String(merchant.id))} />;

  if (authLoading) return <AppShell><LoadingCards /></AppShell>;
  if (!customer) return <AppShell><SignInCard config={authConfig} loading={authLoading} error={authError} onLogin={devLogin} /></AppShell>;

  return <div className={styles.root}><AppShell variant="discovery" header={<HomeHeader addresses={addresses} addressId={addressId} onAddressChange={changeAddress} unreadCount={unreadCount} profileImage={customer.profile_image_url} />}>
    <h1 className="sr-only">ร้านอาหารและโปรโมชันใกล้คุณ</h1>

    <form className={styles.search} onSubmit={submitSearch} role="search">
      <Icon name="search" size={21} /><label className="sr-only" htmlFor="store-search">ค้นหาร้านหรือเมนู</label>
      <input id="store-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="สั่งอะไรดี? ค้นหาร้านหรือเมนู" maxLength={80} />
      <button type="submit" aria-label="ค้นหา"><Icon name="search" size={20} /></button>
    </form>

    <PromoBanner key={banners.map((banner) => `${banner.id}:${banner.image_url}`).join(',') || 'fallback'} banners={banners} loading={loadingBanners} />

    <HomeQuickActions promotionCount={promotions.length} />

    <section className={styles.section} id="recommended-stores" aria-labelledby="stores-title">
      <div className={styles.sectionHeading}><div><h2 id="stores-title">{appliedQuery ? 'ผลการค้นหา' : 'ร้านแนะนำสำหรับคุณ'}</h2><p>{appliedQuery ? `ร้านและเมนูสำหรับ “${appliedQuery}”` : 'เลือกร้านที่ใช่สำหรับมื้อนี้'}</p></div><button type="button" onClick={showAllStores}>ดูทั้งหมด <Icon name="arrow" size={14} /></button></div>
      {storeError ? <div className={styles.empty} role="alert"><p>โหลดร้านไม่สำเร็จ กรุณาลองอีกครั้ง</p><button type="button" onClick={() => loadStores(addressId, appliedQuery)}>ลองใหม่</button></div> : loadingStores ? <div className={styles.storeGrid} role="status" aria-label="กำลังโหลดร้าน">{[0, 1, 2].map((item) => <div key={item} className={styles.storeSkeleton} />)}</div> : <>
        <div className={styles.storeGrid}>{merchants.map(renderStore)}</div>
        {!merchants.length && <div className={styles.empty}><Icon name="search" size={32} /><h3>{appliedQuery ? 'ยังไม่พบร้านหรือเมนูนี้' : 'ยังไม่มีร้านที่พร้อมให้บริการ'}</h3><p>{appliedQuery ? 'ลองคำค้นอื่น หรือกลับไปดูร้านทั้งหมด' : 'กลับมาเลือกร้านอร่อยอีกครั้งภายหลัง'}</p><button type="button" onClick={showAllStores}>ดูร้านทั้งหมด</button></div>}
      </>}
    </section>

  </AppShell></div>;
}
