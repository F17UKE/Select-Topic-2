'use client';
import { ManagementPage } from '../../../components/merchant-management';
import { MerchantContent } from '../../../components/merchant-content';
export default function Page() {
  return <ManagementPage title="โปรโมชั่น">{() => <MerchantContent kind="promotions" />}</ManagementPage>;
}
