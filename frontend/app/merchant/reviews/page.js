'use client';
import { ManagementPage } from '../../../components/merchant-management';
import { MerchantContent } from '../../../components/merchant-content';
export default function Page(){return <ManagementPage title="รีวิวลูกค้า">{()=> <MerchantContent kind="reviews"/>}</ManagementPage>;}
