'use client';

import Link from 'next/link';
import { Icon } from '../icons';

export function CustomerDetailHeader({ title, backHref }) {
  return (
    <header className="customer-detail-header">
      <div className="customer-detail-header-inner">
        <Link className="customer-detail-back" href={backHref} aria-label="ย้อนกลับ">
          <Icon name="back" size={20} />
        </Link>
        <p>{title}</p>
        <span aria-hidden="true" />
      </div>
    </header>
  );
}
