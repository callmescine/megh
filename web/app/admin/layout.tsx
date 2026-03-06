'use client';

import { usePathname } from 'next/navigation';
import { AdminLayout } from '@/components/layouts/admin-layout';

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Don't wrap login page with admin layout
  if (pathname === '/admin/login') {
    return <>{children}</>;
  }

  return <AdminLayout>{children}</AdminLayout>;
}
