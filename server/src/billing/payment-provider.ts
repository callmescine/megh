/**
 * Payment provider abstraction layer.
 * Both Stripe and Razorpay implement this interface so billing logic is provider-agnostic.
 */

export type ProviderName = 'stripe' | 'razorpay';

export interface CheckoutResult {
  url: string;
}

export interface PaymentProvider {
  name: ProviderName;
  isConfigured(): boolean;
  createCustomer(userId: string, email: string): Promise<string>;
  createCheckoutSession(userId: string, amount: number, currency: string): Promise<CheckoutResult>;
  createInvoice(userId: string, amount: number, currency: string, description: string): Promise<string>;
  verifyWebhook(body: Buffer, signature: string): any;
}
