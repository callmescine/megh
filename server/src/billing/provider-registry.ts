import type { PaymentProvider, ProviderName } from './payment-provider.js';
import { query } from '../db/connection.js';

const providers = new Map<ProviderName, PaymentProvider>();

export function registerProvider(provider: PaymentProvider): void {
  providers.set(provider.name, provider);
}

export function getProvider(name: ProviderName): PaymentProvider {
  const provider = providers.get(name);
  if (!provider) {
    throw new Error(`Payment provider '${name}' not registered`);
  }
  if (!provider.isConfigured()) {
    throw new Error(`Payment provider '${name}' is not configured`);
  }
  return provider;
}

export function getAvailableProviders(): ProviderName[] {
  return Array.from(providers.entries())
    .filter(([, p]) => p.isConfigured())
    .map(([name]) => name);
}

export async function getUserProvider(userId: string): Promise<PaymentProvider> {
  const result = await query(
    'SELECT payment_provider FROM users WHERE id = $1',
    [userId]
  );
  const providerName = (result.rows[0]?.payment_provider || 'stripe') as ProviderName;

  // Fall back to whichever provider is configured if preferred one isn't
  try {
    return getProvider(providerName);
  } catch {
    const available = getAvailableProviders();
    if (available.length === 0) {
      throw new Error('No payment providers configured');
    }
    return getProvider(available[0]);
  }
}

export async function setUserProvider(userId: string, provider: ProviderName): Promise<void> {
  // Verify provider is available
  getProvider(provider);

  await query(
    'UPDATE users SET payment_provider = $1 WHERE id = $2',
    [provider, userId]
  );
}
