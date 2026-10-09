'use client';
import { ManagementPage } from '../../../components/merchant-management';
import { MerchantFinance } from '../../../components/merchant-finance';
export default function Page(){return <ManagementPage title="การเงิน" roles={['MANAGER']}>{()=> <MerchantFinance/>}</ManagementPage>;}
