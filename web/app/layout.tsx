import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import ToastContainer from '@/components/Toast';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains' });

export const metadata: Metadata = {
  title: 'Megh',
  description: 'Cloud AI agent platform — on-demand Claude CLI containers',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${jetbrains.variable} font-sans min-h-screen bg-surface-0 text-gray-100`}>
        <ErrorBoundary>
          <AuthProvider>{children}</AuthProvider>
          <ToastContainer />
        </ErrorBoundary>
      </body>
    </html>
  );
}
