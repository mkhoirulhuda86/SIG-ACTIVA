'use client';

import { LayoutDashboard, FileText, TrendingUp, Clock, Users, ShieldCheck, X, ChevronRight, ChevronDown, Layers3, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { isAdmin, getCurrentUserRole, type UserRole } from '../utils/rolePermissions';
import { cn } from '@/lib/utils';
import { Separator } from './ui/separator';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import {
  costStructureAdminNavigation,
  costStructureNavigation,
  navigationContainsPath,
  openNavigationIds,
  visibleNavigationItems,
  type CostNavigationItem,
} from '@/lib/cost-structure/sidebar-navigation';

interface SubMenuItem {
  id?: string;
  label: string;
  href?: string;
  requireAdmin?: boolean;
  children?: SubMenuItem[];
}

interface MenuItem {
  icon: React.ElementType;
  label: string;
  href: string;
  requireAdmin: boolean;
  badge: string | null;
  children?: SubMenuItem[];
}

const menuItems: MenuItem[] = [
  { icon: LayoutDashboard, label: 'Dashboard', href: '/', requireAdmin: false, badge: null },
  { icon: FileText, label: 'Laporan Material', href: '/laporan-material', requireAdmin: false, badge: null },
  {
    icon: FileText,
    label: 'Fluktuasi OI/EXP',
    href: '/fluktuasi-oi',
    requireAdmin: false,
    badge: null,
    children: [
      { label: 'Dashboard Resume', href: '/dashboard-resume-fluktuasi' },
      { label: 'Overview Fluktuasi', href: '/overview-fluktuasi' },
      { label: 'Detail Per Akun', href: '/detail-akun-fluktuasi' },
    ],
  },
  {
    icon: Layers3,
    label: 'Cost Structure & Fluktuasi',
    href: '/cost-structure',
    requireAdmin: false,
    badge: null,
    children: costStructureNavigation,
  },
  { icon: TrendingUp, label: 'Monitoring Prepaid', href: '/monitoring-prepaid', requireAdmin: false, badge: null },
  { icon: Clock, label: 'Monitoring Accrual', href: '/monitoring-accrual', requireAdmin: false, badge: null },
  ...costStructureAdminNavigation.map((item) => ({
    icon: Settings,
    label: item.label,
    href: item.children?.[0]?.href ?? '/cost-structure',
    requireAdmin: true,
    badge: 'Admin',
    children: item.children,
  })),
  { icon: Users, label: 'User Management', href: '/user-management', requireAdmin: true, badge: 'Admin' },
  { icon: ShieldCheck, label: 'Security Status', href: '/security-status', requireAdmin: true, badge: 'Admin' },
];

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ isOpen = true, onClose }: SidebarProps) {
  const pathname = usePathname();
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLUListElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);

  const menuKeysForPath = (path: string) => menuItems.flatMap((item) => {
    if (!item.children?.some((child) => navigationContainsPath(child as CostNavigationItem, path))) return [];
    return [item.href, ...openNavigationIds(item.children as CostNavigationItem[], path)];
  });
  const [openMenus, setOpenMenus] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      return new Set(menuKeysForPath(window.location.pathname));
    }
    return new Set();
  });

  useEffect(() => {
    const menuKeys = menuKeysForPath(pathname);
    // Keep the active nested destination visible after client-side navigation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (menuKeys.length) setOpenMenus(prev => new Set([...prev, ...menuKeys]));
  }, [pathname]);

  const toggleMenu = (href: string) => {
    setOpenMenus(prev => {
      const next = new Set(prev);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      return next;
    });
  };

  useEffect(() => {
    // The role helper reads browser session state, so it is intentionally hydrated client-side.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUserRole(getCurrentUserRole());
  }, []);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.from(sidebarRef.current, { x: -280, opacity: 0, duration: 0.55 });
      if (logoRef.current) tl.fromTo(logoRef.current, { opacity: 0, scale: 0.85, y: -8 }, { opacity: 1, scale: 1, y: 0, duration: 0.45 }, '-=0.3');
      if (navRef.current) tl.fromTo(navRef.current.querySelectorAll('li'), { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.4, stagger: 0.055 }, '-=0.2');
      if (footerRef.current) tl.fromTo(footerRef.current, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.35 }, '-=0.15');
    });
    return () => ctx.revert();
  }, []);

  const handleItemHover = (el: HTMLElement | null, entering: boolean) => {
    if (!el) return;
    gsap.to(el, { x: entering ? 4 : 0, duration: 0.2, ease: 'power2.out' });
  };

  const admin = userRole !== null && isAdmin(userRole);
  const filteredMenuItems = menuItems
    .filter(item => !item.requireAdmin || admin)
    .map(item => ({ ...item, children: item.children ? visibleNavigationItems(item.children as CostNavigationItem[], admin) : undefined }));
  const handleLinkClick = () => { if (onClose) onClose(); };

  const renderChildren = (children: SubMenuItem[], depth = 0): React.ReactNode => (
    <ul className={cn('mt-0.5 space-y-0.5 border-l border-sidebar-border', depth === 0 ? 'ml-4 pl-3' : 'ml-3 pl-2')}>
      {children.map((child) => {
        const key = child.id ?? child.href ?? child.label;
        const childActive = navigationContainsPath(child as CostNavigationItem, pathname);
        const descendantActive = child.children?.some((item) => navigationContainsPath(item as CostNavigationItem, pathname)) === true;
        const childOpen = openMenus.has(key);
        if (child.children?.length) {
          return <li key={key}>
            <button type="button" onClick={() => toggleMenu(key)} aria-expanded={childOpen} className={cn('flex w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold transition-colors', descendantActive ? 'text-sidebar-accent-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground')}>
              {childOpen ? <ChevronDown size={13} className="shrink-0" /> : <ChevronRight size={13} className="shrink-0" />}
              <span className="min-w-0 flex-1 whitespace-normal break-words leading-tight">{child.label}</span>
            </button>
            {childOpen && renderChildren(child.children, depth + 1)}
          </li>;
        }
        return <li key={key}><Link href={child.href!} onClick={handleLinkClick} aria-current={childActive ? 'page' : undefined} className={cn('group flex min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors relative', childActive ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground')}>
          {childActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-primary rounded-r-full" />}<span className="w-1.5 h-1.5 rounded-full bg-current opacity-50 shrink-0" /><span className="min-w-0 flex-1 whitespace-normal break-words leading-tight">{child.label}</span>{childActive && <ChevronRight size={12} className="text-primary opacity-60 shrink-0" />}
        </Link></li>;
      })}
    </ul>
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div ref={sidebarRef} data-state={isOpen ? 'open' : 'closed'} className="w-64 h-screen overflow-x-hidden bg-sidebar border-r border-sidebar-border flex flex-col shadow-sm relative">
        <button onClick={onClose} className="lg:hidden absolute top-4 right-4 p-1.5 hover:bg-accent rounded-lg z-10 transition-colors"><X size={18} className="text-muted-foreground" /></button>
        <div ref={logoRef} className="px-5 py-5 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 flex items-center justify-center drop-shadow-sm shrink-0"><img src="/logo-aplikasi.png" alt="SIG ACTIVA Logo" className="w-14 h-14 object-contain animate-floatUp" /></div>
            <div><h2 className="font-bold text-foreground text-base leading-tight">SIG ACTIVA</h2><p className="text-[11px] text-muted-foreground leading-tight mt-0.5">Sistem Informasi<br />Akuntansi</p></div>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <nav className="px-3 py-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold px-3 mb-3">Menu Utama</p>
            <ul ref={navRef} className="space-y-0.5">
              {filteredMenuItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                const hasChildren = !!item.children?.length;
                const menuOpen = openMenus.has(item.href);
                const isParentActive = isActive || (hasChildren && item.children!.some(c => navigationContainsPath(c as CostNavigationItem, pathname)));
                return <li key={item.href}>
                  {hasChildren ? (
                    <div className={cn('group flex items-center rounded-lg transition-colors relative', isParentActive ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground')}>
                      {isParentActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />}
                      <Link href={item.href} onClick={() => { handleLinkClick(); setOpenMenus(prev => new Set([...prev, item.href])); }} onMouseEnter={e => handleItemHover(e.currentTarget as HTMLElement, true)} onMouseLeave={e => handleItemHover(e.currentTarget as HTMLElement, false)} className="flex items-center gap-3 px-3 py-2.5 flex-1 min-w-0 text-sm font-medium">
                        <Icon size={17} className={cn('shrink-0 transition-transform group-hover:scale-110', isParentActive ? 'text-primary' : '')} />
                        <span className="min-w-0 flex-1 whitespace-normal break-words leading-tight">{item.label}</span>{item.badge && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{item.badge}</Badge>}
                      </Link>
                      <button type="button" onClick={() => toggleMenu(item.href)} className="px-2 py-2.5 shrink-0 opacity-60 hover:opacity-100 transition-opacity">{menuOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
                    </div>
                  ) : (
                    <Tooltip><TooltipTrigger asChild><Link href={item.href} onClick={handleLinkClick} onMouseEnter={e => handleItemHover(e.currentTarget as HTMLElement, true)} onMouseLeave={e => handleItemHover(e.currentTarget as HTMLElement, false)} className={cn('group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors relative', isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground')}>
                      {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />}<Icon size={17} className={cn('shrink-0 transition-transform group-hover:scale-110', isActive ? 'text-primary' : '')} /><span className="flex-1 truncate">{item.label}</span>{item.badge && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{item.badge}</Badge>}{isActive && <ChevronRight size={14} className="text-primary opacity-60 shrink-0" />}
                    </Link></TooltipTrigger><TooltipContent side="right" className="text-xs">{item.label}</TooltipContent></Tooltip>
                  )}
                  {hasChildren && menuOpen && renderChildren(item.children!)}
                </li>;
              })}
            </ul>
          </nav>
        </ScrollArea>

        <Separator />
        <div ref={footerRef} className="p-4"><div className="flex items-center gap-2 px-2 py-2"><div className="w-7 h-7 rounded-full bg-white border border-sidebar-border flex items-center justify-center shrink-0 overflow-hidden"><img src="/logo-aplikasi.png" alt="SIG ACTIVA Footer Logo" className="w-6 h-6 object-contain" /></div><div className="min-w-0"><p className="text-[11px] font-medium text-foreground truncate">PT Semen Indonesia Grup</p><p className="text-[10px] text-muted-foreground">v2.0.0</p></div></div></div>
      </div>
    </TooltipProvider>
  );
}
