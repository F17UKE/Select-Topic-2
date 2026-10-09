'use client';

import { useEffect, useState } from 'react';
import { AppShell, LoadingCards, SignInCard } from '../../components/app-shell';
import { CustomerDetailHeader } from '../../components/customer/detail-header';
import { HomeStoreCard } from '../../components/home/store-card';
import { Icon } from '../../components/icons';
import { api } from '../../lib/api';
import { useCustomer } from '../../lib/use-customer';

export default function FavoritesPage() {
  const session = useCustomer();
  const [merchants, setMerchants] = useState([]);
  const [addressId, setAddressId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!session.customer) return;
    let active = true;
    api('/api/customer/addresses').then((addresses) => {
      const selected = addresses.addresses.find((item) => item.is_default)?.id || addresses.addresses[0]?.id || '';
      setAddressId(String(selected));
      return api(`/api/customer/favorites${selected ? `?addressId=${selected}` : ''}`);
    }).then((result) => { if (active) setMerchants(result.merchants); })
      .catch((requestError) => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session.customer]);
  const header = <CustomerDetailHeader title="ร้านโปรด" backHref="/profile" />;
  if (session.loading || loading) return <AppShell variant="home" header={header}><LoadingCards /></AppShell>;
  if (!session.customer) return <AppShell header={header}><SignInCard config={session.authConfig} onLogin={session.devLogin} /></AppShell>;
  return <AppShell variant="home" header={header}><section className="home-store-section"><div className="home-section-heading"><div><h1>ร้านโปรดของฉัน</h1><span>{merchants.length} ร้าน</span></div></div>{error && <p className="form-error">{error}</p>}<div className="home-store-grid">{merchants.map((merchant) => <HomeStoreCard key={merchant.id} merchant={merchant} addressId={addressId} onFavoriteChange={(id, favorite) => { if (!favorite) setMerchants((rows) => rows.filter((row) => row.id !== id)); }} />)}</div>{!merchants.length && !error && <div className="empty-state"><Icon name="heart" size={36} /><h2>ยังไม่มีร้านโปรด</h2><p>กดหัวใจที่หน้าร้านเพื่อเก็บไว้ที่นี่</p></div>}</section></AppShell>;
}
