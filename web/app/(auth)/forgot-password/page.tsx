'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { AuthLayout } from '@/components/layouts/auth-layout';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch(`${API_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch {
      // Ignore errors — always show success
    }
    setSubmitted(true);
    setLoading(false);
  };

  return (
    <AuthLayout>
      <div className="space-y-6">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-white">Reset Password</h2>
          <p className="mt-1 text-sm text-gray-400">
            Enter your email to receive a password reset link
          </p>
        </div>

        {submitted ? (
          <div className="p-4 rounded-lg bg-green-900/30 border border-green-800 text-green-300 text-sm text-center">
            If an account with that email exists, a password reset link has been sent.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Sending...' : 'Send Reset Link'}
            </Button>
          </form>
        )}

        <p className="text-center text-sm text-gray-400">
          <Link href="/login" className="text-megh-400 hover:text-megh-300 transition-colors">
            Back to sign in
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
