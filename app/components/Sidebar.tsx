'use client';

import { LayoutDashboard, FileText, TrendingUp, Clock, Users, X, ChevronRight, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { isAdmin, getCurrentUserRole } from '../utils/rolePermissions';
import { cn } from '@/lib/utils';
import { Separator } from './ui/separator';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

interface SubMenuItem {
  label: string;
  href:  string;
}

interface MenuItem {
  icon:         React.ElementType;
  label:        string;
  href:         string;
  requireAdmin: boolean;
  badge:        string | null;
  children?:    SubMenuItem[];
}

const menuItems: MenuItem[] = [
  { icon: LayoutDashboard, label: 'Dashboard',          href: '/',                   requireAdmin: false, badge: null },
  { icon: FileText,        label: 'Laporan Material',   href: '/laporan-material',   requireAdmin: false, badge: null },
  {
    icon: FileText,
    label: 'Fluktuasi OI/EXP',
    href: '/fluktuasi-oi',
    requireAdmin: false,
    badge: null,
    children: [
      { label: 'Overview Fluktuasi', href: '/overview-fluktuasi'      },
      { label: 'Sub Akun Fluktuasi', href: '/sub-akun-fluktuasi'      },
      { label: 'Detail Per Akun',    href: '/detail-akun-fluktuasi'   },
    ],
  },
  { icon: TrendingUp,      label: 'Monitoring Prepaid', href: '/monitoring-prepaid', requireAdmin: false, badge: null },
  { icon: Clock,           label: 'Monitoring Accrual', href: '/monitoring-accrual', requireAdmin: false, badge: null },
  { icon: Users,           label: 'User Management',    href: '/user-management',    requireAdmin: true,  badge: 'Admin' },
];

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ isOpen = true, onClose }: SidebarProps) {
  const pathname = usePathname();
  const [userRole, setUserRole] = useState<string | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const logoRef   = useRef<HTMLDivElement>(null);
  const navRef    = useRef<HTMLUListElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);

  // Track which parent menus are open (by href)
  const fluktuasiSubPaths = ['/overview-fluktuasi', '/sub-akun-fluktuasi', '/detail-akun-fluktuasi'];
  const [openMenus, setOpenMenus] = useState<Set<string>>(() => {
    // Auto-open if current path is a child
    if (typeof window !== 'undefined') {
      const p = window.location.pathname;
      if (fluktuasiSubPaths.includes(p)) return new Set(['/fluktuasi-oi']);
    }
    return new Set();
  });

  // Also auto-open when pathname changes (e.g. direct navigation)
  useEffect(() => {
    if (fluktuasiSubPaths.includes(pathname)) {
      setOpenMenus(prev => new Set([...prev, '/fluktuasi-oi']));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const toggleMenu = (href: string) => {
    setOpenMenus(prev => {
      const next = new Set(prev);
      next.has(href) ? next.delete(href) : next.add(href);
      return next;
    });
  };

  useEffect(() => {
    const role = getCurrentUserRole();
    setUserRole(role);
  }, []);

  /* ── GSAP entrance timeline ─────────────────────────────────── */
  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

      // Sidebar slides in from left
      tl.from(sidebarRef.current, {
        x: -280,
        opacity: 0,
        duration: 0.55,
      });

      // Logo fades + scales in
      if (logoRef.current) {
        tl.fromTo(
          logoRef.current,
          { opacity: 0, scale: 0.85, y: -8 },
          { opacity: 1, scale: 1, y: 0, duration: 0.45 },
          '-=0.3'
        );
      }

      // Nav items stagger in
      if (navRef.current) {
        tl.fromTo(
          navRef.current.querySelectorAll('li'),
          { opacity: 0, x: -20 },
          { opacity: 1, x: 0, duration: 0.4, stagger: 0.055 },
          '-=0.2'
        );
      }

      // Footer
      if (footerRef.current) {
        tl.fromTo(
          footerRef.current,
          { opacity: 0, y: 12 },
          { opacity: 1, y: 0, duration: 0.35 },
          '-=0.15'
        );
      }
    });

    return () => ctx.revert();
  }, []);

  /* ── Active link indicator hover animation ──────────────────── */
  const handleItemHover = (el: HTMLElement | null, entering: boolean) => {
    if (!el) return;
    gsap.to(el, {
      x: entering ? 4 : 0,
      duration: 0.2,
      ease: 'power2.out',
    });
  };

  const filteredMenuItems = menuItems.filter(item => {
    if (item.requireAdmin && userRole) return isAdmin(userRole as any);
    return true;
  });

  const handleLinkClick = () => { if (onClose) onClose(); };

  return (
    <TooltipProvider delayDuration={300}>
      <div
        ref={sidebarRef}
        className="w-64 h-screen bg-sidebar border-r border-sidebar-border flex flex-col shadow-sm relative"
      >
        {/* Close button – mobile only */}
        <button
          onClick={onClose}
          className="lg:hidden absolute top-4 right-4 p-1.5 hover:bg-accent rounded-lg z-10 transition-colors"
        >
          <X size={18} className="text-muted-foreground" />
        </button>

        {/* Logo */}
        <div ref={logoRef} className="px-5 py-5 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 flex items-center justify-center drop-shadow-sm shrink-0">
              <img
                src="/logo aplikasi.png"
                alt="SIG ACTIVA Logo"
                className="w-14 h-14 object-contain animate-floatUp"
              />
            </div>
            <div>
              <h2 className="font-bold text-foreground text-base leading-tight">SIG ACTIVA</h2>
              <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                Sistem Informasi<br />Akuntansi
              </p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1">
          <nav className="px-3 py-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold px-3 mb-3">
              Menu Utama
            </p>
            <ul ref={navRef} className="space-y-0.5">
              {filteredMenuItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                const hasChildren = !!item.children?.length;
                const isOpen = openMenus.has(item.href);
                // parent is "active" if its own path or any child is current
                const isParentActive = isActive || (hasChildren && item.children!.some(c => pathname === c.href));

                return (
                  <li key={item.href}>
                    {/* Parent item */}
                    {hasChildren ? (
                      <div className={cn(
                        'group flex items-center rounded-lg transition-colors relative',
                        isParentActive
                          ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                      )}>
                        {isParentActive && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                        )}
                        {/* Navigates to parent href */}
                        <Link
                          href={item.href}
                          onClick={() => {
                            handleLinkClick();
                            setOpenMenus(prev => new Set([...prev, item.href]));
                          }}
                          onMouseEnter={e => handleItemHover(e.currentTarget as HTMLElement, true)}
                          onMouseLeave={e => handleItemHover(e.currentTarget as HTMLElement, false)}
                          className="flex items-center gap-3 px-3 py-2.5 flex-1 min-w-0 text-sm font-medium"
                        >
                          <Icon size={17} className={cn('shrink-0 transition-transform group-hover:scale-110', isParentActive ? 'text-primary' : '')} />
                          <span className="flex-1 truncate">{item.label}</span>
                          {item.badge && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{item.badge}</Badge>
                          )}
                        </Link>
                        {/* Chevron toggles submenu only */}
                        <button
                          type="button"
                          onClick={() => toggleMenu(item.href)}
                          className="px-2 py-2.5 shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                        >
                          {isOpen
                            ? <ChevronDown size={14} />
                            : <ChevronRight size={14} />
                          }
                        </button>
                      </div>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Link
                            href={item.href}
                            onClick={handleLinkClick}
                            onMouseEnter={e => handleItemHover(e.currentTarget as HTMLElement, true)}
                            onMouseLeave={e => handleItemHover(e.currentTarget as HTMLElement, false)}
                            className={cn(
                              'group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors relative',
                              isActive
                                ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                            )}
                          >
                            {isActive && (
                              <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                            )}
                            <Icon size={17} className={cn('shrink-0 transition-transform group-hover:scale-110', isActive ? 'text-primary' : '')} />
                            <span className="flex-1 truncate">{item.label}</span>
                            {item.badge && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{item.badge}</Badge>
                            )}
                            {isActive && <ChevronRight size={14} className="text-primary opacity-60 shrink-0" />}
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="text-xs">{item.label}</TooltipContent>
                      </Tooltip>
                    )}

                    {/* Sub-menu items */}
                    {hasChildren && isOpen && (
                      <ul className="mt-0.5 ml-4 pl-3 border-l border-sidebar-border space-y-0.5">
                        {item.children!.map(child => {
                          const childActive = pathname === child.href;
                          return (
                            <li key={child.href}>
                              <Link
                                href={child.href}
                                onClick={handleLinkClick}
                                className={cn(
                                  'group flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors relative',
                                  childActive
                                    ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                                )}
                              >
                                {childActive && (
                                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-primary rounded-r-full" />
                                )}
                                <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50 shrink-0" />
                                <span className="flex-1 truncate">{child.label}</span>
                                {childActive && <ChevronRight size={12} className="text-primary opacity-60 shrink-0" />}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>
        </ScrollArea>

        <Separator />

        {/* Footer */}
        <div ref={footerRef} className="p-4">
          <div className="flex items-center gap-2 px-2 py-2">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-[10px] font-bold text-primary">SIG</span>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-foreground truncate">PT Semen Indonesia Grup</p>
              <p className="text-[10px] text-muted-foreground">v2.0.0</p>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

