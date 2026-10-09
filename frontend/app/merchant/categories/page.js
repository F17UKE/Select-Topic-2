'use client';
import { ManagementPage } from '../../../components/merchant-management';
import { CategoryManager } from '../../../components/merchant-catalog';
export default function Page() {
  return <ManagementPage title="หมวดหมู่">{() => <CategoryManager />}</ManagementPage>;
}
