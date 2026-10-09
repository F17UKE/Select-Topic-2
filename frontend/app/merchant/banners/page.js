'use client';
import { ManagementPage } from '../../../components/merchant-management';
import { MerchantContent } from '../../../components/merchant-content';
export default function Page() {
  return <ManagementPage title="แบนเนอร์">{() => <MerchantContent kind="banners" />}</ManagementPage>;
}
