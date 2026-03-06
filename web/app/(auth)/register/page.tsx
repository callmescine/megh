'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { AuthLayout } from '@/components/layouts/auth-layout';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const passwordValid = password.length >= 8;
  const showPasswordValidation = password.length > 0;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!passwordValid) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      await register(email, password);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="space-y-6">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-white">Create Account</h2>
          <p className="mt-1 text-sm text-gray-400">Get started with Megh</p>
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

          <div>
            <Input
              label="Password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 8 characters"
            />
            {showPasswordValidation && (
              <p className={`text-xs mt-1.5 ${passwordValid ? 'text-green-400' : 'text-red-400'}`}>
                {passwordValid
                  ? 'Password strength: OK'
                  : `Password must be at least 8 characters (${password.length}/8)`}
              </p>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={loading || !passwordValid}>
            {loading ? 'Creating account...' : 'Create Account'}
          </Button>
        </form>

        <p className="text-center text-sm text-gray-400">
          Already have an account?{' '}
          <Link href="/login" className="text-megh-400 hover:text-megh-300 transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
