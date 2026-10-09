'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppShell, LoadingCards, SignInCard } from '../../../components/app-shell';
import { CustomerDetailHeader } from '../../../components/customer/detail-header';
import { StoreDetailContent } from '../../../components/customer/store-detail-content';
import styles from '../../../components/customer/store-detail.module.css';
import { api } from '../../../lib/api';
import { useCustomer } from '../../../lib/use-customer';

export default function StoreDetailPage() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const session = useCustomer();
  const [merchant, setMerchant] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [activeCategoryId, setActiveCategoryId] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!session.customer) return;
    const addressId = searchParams.get('addressId');
    Promise.all([
      api(`/api/merchants/${id}${addressId ? `?addressId=${addressId}` : ''}`),
      api(`/api/merchants/${id}/reviews`),
    ]).then(([result, reviewResult]) => {
        setMerchant(result.merchant);
        setReviews(reviewResult.reviews);
        setActiveCategoryId(result.merchant.categories[0]?.id || null);
      })
      .catch((requestError) => setError(requestError.message));
  }, [id, searchParams, session.customer]);

  async function toggleFavorite() {
    const next = !merchant.is_favorite;
    setMerchant({ ...merchant, is_favorite: next });
    try { await api(`/api/customer/favorites/${merchant.id}`, { method: next ? 'POST' : 'DELETE' }); }
    catch { setMerchant({ ...merchant, is_favorite: !next }); }
  }

  const detailHeader = <CustomerDetailHeader title={merchant?.store_name || 'รายละเอียดร้าน'} backHref="/" />;
  if (session.loading || (session.customer && !merchant && !error)) return <AppShell variant="customer-detail" header={detailHeader}><LoadingCards /></AppShell>;
  if (!session.customer) return <AppShell variant="customer-detail" header={detailHeader}><SignInCard config={session.authConfig} loading={session.loading} error={session.error} onLogin={session.devLogin} /></AppShell>;
  if (error) return <AppShell variant="customer-detail" header={detailHeader}><div className="empty-state"><h1>ไม่พบร้านนี้</h1><p>{error}</p></div></AppShell>;

  return (
    <div className={styles.page}><AppShell variant="customer-detail" header={detailHeader}>
      <StoreDetailContent merchant={merchant} reviews={reviews} onFavorite={toggleFavorite}
        activeCategoryId={activeCategoryId} onCategory={setActiveCategoryId} />
    </AppShell></div>
  );
}
