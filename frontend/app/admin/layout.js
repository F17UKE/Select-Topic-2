'use client';

import './admin-ui.css';
import { AdminProvider } from '../../lib/use-admin';

export default function AdminLayout({ children }) {
  return <AdminProvider>{children}</AdminProvider>;
}
