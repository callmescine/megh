'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { UserLayout } from '@/components/layouts/user-layout';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableHead, TableBody, TableRow, TableCell, TableHeaderCell } from '@/components/ui/table';
import { Spinner } from '@/components/ui/spinner';

interface Invoice {
  id: string;
  created_at: string;
  amount: number;
  status: string;
  hosted_invoice_url?: string;
}

export default function InvoicesPage() {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      api.billing.invoices()
        .then((data) => setInvoices(Array.isArray(data) ? data : (data.invoices || [])))
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [user]);

  const statusVariant = (status: string) => {
    const map: Record<string, 'success' | 'warning' | 'danger' | 'default'> = {
      paid: 'success', open: 'warning', void: 'default', draft: 'default', uncollectible: 'danger',
    };
    return map[status] || 'default';
  };

  return (
    <UserLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/billing" className="text-sm text-gray-400 hover:text-white transition-colors">
            &larr; Back to Billing
          </Link>
        </div>

        <h1 className="text-2xl font-bold text-white">Invoices</h1>

        {loading ? (
          <div className="flex justify-center py-10"><Spinner size="lg" /></div>
        ) : (
          <Card>
            <CardContent>
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Date</TableHeaderCell>
                    <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell className="text-right">Actions</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {invoices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-gray-500 py-8">
                        No invoices yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    invoices.map((invoice) => (
                      <TableRow key={invoice.id}>
                        <TableCell className="text-gray-300 whitespace-nowrap">
                          {new Date(invoice.created_at).toLocaleDateString(undefined, {
                            year: 'numeric', month: 'short', day: 'numeric',
                          })}
                        </TableCell>
                        <TableCell className="text-right text-gray-200 font-medium">
                          ${((invoice.amount || 0) / 100).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(invoice.status)}>{invoice.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {invoice.hosted_invoice_url ? (
                            <a
                              href={invoice.hosted_invoice_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-megh-400 hover:text-megh-300 transition-colors text-sm"
                            >
                              View Invoice
                            </a>
                          ) : (
                            <span className="text-gray-600">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </UserLayout>
  );
}
