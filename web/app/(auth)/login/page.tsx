'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { AuthLayout } from '@/components/layouts/auth-layout';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="space-y-6">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-white">Sign In</h2>
          <p className="mt-1 text-sm text-gray-400">Sign in to your Megh account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-900/50 border border-red-800 text-red-300 text-sm">
              {error}
            </div>
          )}

          <Input
            label="Email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />

          <Input
            label="Password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
          />

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </Button>
        </form>

        <div className="text-center space-y-2">
          <p className="text-sm text-gray-400">
            <Link href="/forgot-password" className="text-megh-400 hover:text-megh-300 transition-colors">
              Forgot your password?
            </Link>
          </p>
          <p className="text-sm text-gray-400">
            Don&apos;t have an account?{' '}
            <Link href="/register" className="text-megh-400 hover:text-megh-300 transition-colors">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}
