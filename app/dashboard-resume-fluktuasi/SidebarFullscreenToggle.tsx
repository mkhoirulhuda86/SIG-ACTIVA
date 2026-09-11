'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'dashboard-resume-sidebar-collapsed';
const ROOT_CLASS = 'dashboard-resume-sidebar-collapsed';

export default function SidebarFullscreenToggle() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const initial = window.localStorage.getItem(STORAGE_KEY) === '1';
    setCollapsed(initial);
    document.documentElement.classList.toggle(ROOT_CLASS, initial);

    return () => {
      document.documentElement.classList.remove(ROOT_CLASS);
    };
  }, []);

  const toggleSidebar = () => {
    const next = !collapsed;
    setCollapsed(next);
    window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    document.documentElement.classList.toggle(ROOT_CLASS, next);
  };

  return (
    <button
      type="button"
      className="dashboard-sidebar-toggle"
      onClick={toggleSidebar}
      aria-label={collapsed ? 'Tampilkan menu sidebar' : 'Sembunyikan menu sidebar'}
      aria-expanded={!collapsed}
      title={collapsed ? 'Tampilkan menu sidebar' : 'Sembunyikan menu sidebar'}
    >
      {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
    </button>
  );
}
