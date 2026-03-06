interface StatCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
}

export function StatCard({ label, value, subtitle, trend }: StatCardProps) {
  return (
    <div className="bg-surface-50 border border-surface-300 rounded-xl p-5">
      <p className="text-sm text-gray-500 font-medium">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
      {subtitle && (
        <p className={`mt-1 text-xs ${
          trend === 'up' ? 'text-green-400' : trend === 'down' ? 'text-red-400' : 'text-gray-500'
        }`}>
          {subtitle}
        </p>
      )}
    </div>
  );
}
