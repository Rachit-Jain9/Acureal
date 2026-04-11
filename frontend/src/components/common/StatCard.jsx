export default function StatCard({ title, value, subtitle, icon: Icon, trend, accent }) {
  const accentClass = accent === 'green'
    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700/50'
    : accent === 'amber'
      ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700/50'
      : accent === 'red'
        ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700/50'
        : '';

  return (
    <div className={`card ${accentClass}`}>
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{title}</p>
          <p className="text-2xl font-bold mt-1 text-gray-900 dark:text-white">{value}</p>
          {subtitle && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 truncate">{subtitle}</p>
          )}
        </div>
        {Icon && (
          <div className="p-2 bg-primary-50 dark:bg-primary-900/30 rounded-lg ml-3 flex-shrink-0">
            <Icon className="text-primary-600 dark:text-primary-400" size={20} />
          </div>
        )}
      </div>
      {trend != null && (
        <div className={`mt-2 text-xs font-medium ${
          trend > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
        }`}>
          {trend > 0 ? '+' : ''}{trend}% from last month
        </div>
      )}
    </div>
  );
}
