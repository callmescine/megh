import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-600 mb-4">404</h1>
        <h2 className="text-xl font-semibold text-gray-300 mb-2">Page not found</h2>
        <p className="text-gray-500 mb-6">The page you are looking for does not exist.</p>
        <Link
          href="/dashboard"
          className="px-6 py-3 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 transition-colors"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
