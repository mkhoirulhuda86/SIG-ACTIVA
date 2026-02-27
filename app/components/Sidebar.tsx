'use client';

import { LayoutDashboard, FileText, TrendingUp, Clock, Users, X, BarChart2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { isAdmin, getCurrentUserRole } from '../utils/rolePermissions';

const menuItems = [
  { icon: LayoutDashboard, label: 'Dashboard', href: '/', requireAdmin: false },
  { icon: FileText, label: 'Laporan Material', href: '/laporan-material', requireAdmin: false },
  { icon: FileText, label: 'Fluktuasi OI/EXP', href: '/fluktuasi-oi', requireAdmin: false },
  { icon: BarChart2, label: 'Overview Fluktuasi', href: '/overview-fluktuasi', requireAdmin: false },
  { icon: TrendingUp, label: 'Monitoring Prepaid', href: '/monitoring-prepaid', requireAdmin: false },
  { icon: Clock, label: 'Monitoring Accrual', href: '/monitoring-accrual', requireAdmin: false },
  { icon: Users, label: 'User Management', href: '/user-management', requireAdmin: true },
];

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ isOpen = true, onClose }: SidebarProps) {
  const pathname = usePathname();
  const [userRole, setUserRole] = useState<string | null>(null);

  useEffect(() => {
    const role = getCurrentUserRole();
    setUserRole(role);
  }, []);

  const filteredMenuItems = menuItems.filter(item => {
    if (item.requireAdmin && userRole) {
      return isAdmin(userRole as any);
    }
    return true;
  });

  const handleLinkClick = () => {
    if (onClose) {
      onClose();
    }
  };

  return (
    <div className="w-64 h-screen bg-white border-r border-gray-200 flex flex-col shadow-sm">
      {/* Close button for mobile */}
      <button
        onClick={onClose}
        className="lg:hidden absolute top-4 right-4 p-2 hover:bg-gray-100 rounded-lg z-10"
      >
        <X size={20} className="text-gray-600" />
      </button>

        {/* Logo/Brand */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 flex items-center justify-center">
              <img src="/logo aplikasi.png" alt="SIG ACTIVA Logo" className="w-16 h-16 object-contain" />
            </div>
            <div>
              <h2 className="font-bold text-gray-800 text-lg">SIG ACTIVA</h2>
            </div>
          </div>
        </div>

        {/* Menu Items */}
        <nav className="flex-1 p-4 overflow-y-auto">
          <ul className="space-y-2">
            {filteredMenuItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={handleLinkClick}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                      isActive
                        ? 'bg-red-50 text-red-600'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <Icon size={20} />
                    <span className="text-sm font-medium">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
  );
}
