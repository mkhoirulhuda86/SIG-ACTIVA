'use client';

import { memo } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  color: string;
}

function MetricCard({
  title,
  value,
  icon,
  color,
}: MetricCardProps) {
  const getColorClasses = (color: string) => {
    switch (color) {
      case 'blue':
        return 'bg-blue-100 text-blue-600';
      case 'green':
        return 'bg-green-100 text-green-600';
      case 'red':
        return 'bg-red-100 text-red-600';
      case 'purple':
        return 'bg-purple-100 text-purple-600';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6 hover-lift transition-smooth h-full">
      <div className="flex items-center justify-between h-full">
        <div className="flex-1 min-w-0 pr-3">
          <p className="text-xs sm:text-sm text-gray-500 mb-1 truncate">{title}</p>
          <h3 className="text-base sm:text-lg lg:text-xl font-bold text-gray-800 leading-tight break-all">{value}</h3>
        </div>
        <div className={`p-2 sm:p-3 rounded-lg flex-shrink-0 ${getColorClasses(color)}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

export default memo(MetricCard);
