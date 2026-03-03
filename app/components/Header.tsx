'use client';

import { Bell, User, LogOut, Menu, AlertCircle, TrendingUp, Package, RefreshCw } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { animate, stagger } from 'animejs';
import { gsap } from 'gsap';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Avatar, AvatarFallback } from './ui/avatar';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { ScrollArea } from './ui/scroll-area';

interface HeaderProps {
  title: string;
  subtitle: string;
  onMenuClick?: () => void;
}

interface Notification {
  id: string;
  type: 'accrual' | 'prepaid' | 'material';
  title: string;
  message: string;
  link: string;
  priority: 'high' | 'medium' | 'low';
  createdAt: string;
}

const priorityVariant: Record<string, string> = {
  high:   'border-l-4 border-destructive bg-destructive/5',
  medium: 'border-l-4 border-yellow-400 bg-yellow-50',
  low:    'border-l-4 border-blue-400 bg-blue-50',
};

export default function Header({ title, subtitle, onMenuClick }: HeaderProps) {
  const [showLogout,       setShowLogout]       = useState(false);
  const [showNotifications,setShowNotifications]= useState(false);
  const [notifications,    setNotifications]    = useState<Notification[]>([]);
  const [notificationCount,setNotificationCount]= useState(0);
  const [loadingNotifs,    setLoadingNotifs]    = useState(false);
  const [userName,         setUserName]         = useState('User');
  const [userRole,         setUserRole]         = useState('');
  const [readNotifications,setReadNotifications]= useState<Set<string>>(new Set());

  const dropdownRef     = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);
  const headerRef       = useRef<HTMLDivElement>(null);
  const bellRef         = useRef<HTMLButtonElement>(null);
  const notifPanelRef   = useRef<HTMLDivElement>(null);
  const userPanelRef    = useRef<HTMLDivElement>(null);

  /* â”€â”€ Entrance animation (anime.js) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  useEffect(() => {
    if (!headerRef.current) return;
    animate(headerRef.current, {
      translateY: [-40, 0],
      opacity: [0, 1],
      duration: 600,
      ease: 'outExpo',
    });
  }, []);

  /* â”€â”€ Bell shake animation on new notifications â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const shakeBell = () => {
    if (!bellRef.current) return;
    animate(bellRef.current, {
      rotate: [{ to: -15 }, { to: 15 }, { to: -10 }, { to: 10 }, { to: 0 }],
      duration: 600,
      ease: 'inOutSine',
    });
  };

  /* â”€â”€ Dropdown open/close animations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const animatePanel = (el: HTMLElement | null, show: boolean) => {
    if (!el) return;
    if (show) {
      animate(el, {
        opacity: [0, 1],
        translateY: [-8, 0],
        scale: [0.97, 1],
        duration: 220,
        ease: 'outCubic',
      });
    } else {
      animate(el, {
        opacity: 0,
        translateY: -6,
        scale: 0.97,
        duration: 160,
        ease: 'inCubic',
      });
    }
  };

  /* â”€â”€ Notification items stagger in â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const animateNotifItems = () => {
    setTimeout(() => {
      const items = notifPanelRef.current?.querySelectorAll('.notif-item');
      if (!items?.length) return;
      animate(items, {
        opacity: [0, 1],
        translateX: [12, 0],
        duration: 350,
        delay: stagger(45),
        ease: 'outExpo',
      });
    }, 50);
  };

  useEffect(() => {
    const username = localStorage.getItem('username') || 'User';
    const role     = localStorage.getItem('userRole') || '';
    setUserName(username);
    setUserRole(role);

    const readIds = localStorage.getItem('readNotifications');
    if (readIds) setReadNotifications(new Set(JSON.parse(readIds)));

    fetchNotifications();
    const interval = setInterval(fetchNotifications, 5 * 60 * 1000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchNotifications = async () => {
    try {
      setLoadingNotifs(true);
      const res = await fetch('/api/notifications');
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        const readIds  = localStorage.getItem('readNotifications');
        const readSet  = readIds ? new Set(JSON.parse(readIds)) : new Set<string>();
        const unread = (data.notifications as Notification[]).filter(n => !readSet.has(n.id)).length;
        if (unread > notificationCount) shakeBell();
        setNotificationCount(unread);
      }
    } catch { /* silent */ } finally { setLoadingNotifs(false); }
  };

  const markAsRead = (id: string) => {
    const next = new Set(readNotifications); next.add(id);
    setReadNotifications(next);
    localStorage.setItem('readNotifications', JSON.stringify([...next]));
    setNotificationCount(notifications.filter(n => !next.has(n.id)).length);
  };

  const markAllAsRead = () => {
    const all = new Set(notifications.map(n => n.id));
    setReadNotifications(all);
    localStorage.setItem('readNotifications', JSON.stringify([...all]));
    setNotificationCount(0);
  };

  const handleLogout = () => {
    ['isAuthenticated','username','userName','userRole','userId'].forEach(k => localStorage.removeItem(k));
    window.location.href = '/login';
  };

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowLogout(false);
      if (notificationRef.current && !notificationRef.current.contains(e.target as Node)) setShowNotifications(false);
    };
    if (showLogout || showNotifications) document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [showLogout, showNotifications]);

  const handleToggleNotif = () => {
    const next = !showNotifications;
    setShowNotifications(next);
    animatePanel(notifPanelRef.current, next);
    if (next) animateNotifItems();
  };

  const handleToggleUser = () => {
    const next = !showLogout;
    setShowLogout(next);
    animatePanel(userPanelRef.current, next);
  };

  const getNotifIcon = (type: string) => ({
    accrual:  <TrendingUp  size={14} className="text-blue-500" />,
    prepaid:  <AlertCircle size={14} className="text-orange-500" />,
    material: <Package     size={14} className="text-purple-500" />,
  }[type] ?? <Bell size={14} className="text-muted-foreground" />);

  const initials = userName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  const formatRole = (r: string) =>
    r.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <header
      ref={headerRef}
      className="bg-background border-b border-border px-4 md:px-6 py-3 flex items-center justify-between sticky top-0 z-40 shadow-sm"
    >
      {/* Left */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onMenuClick}
          className="lg:hidden h-9 w-9"
        >
          <Menu size={20} />
        </Button>

        <div>
          <h1 className="text-base md:text-xl font-bold text-foreground leading-tight">{title}</h1>
          <p className="text-xs text-muted-foreground hidden sm:block">{subtitle}</p>
        </div>
      </div>

      {/* Right */}
      <div className="flex items-center gap-1.5 md:gap-2">

        {/* Notifications */}
        <div className="relative" ref={notificationRef}>
          <Button
            ref={bellRef}
            variant="ghost"
            size="icon"
            onClick={handleToggleNotif}
            className="relative h-9 w-9"
          >
            <Bell size={18} />
            {notificationCount > 0 && (
              <Badge
                variant="destructive"
                className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 text-[10px] font-bold flex items-center justify-center rounded-full animate-scaleIn"
              >
                {notificationCount > 9 ? '9+' : notificationCount}
              </Badge>
            )}
          </Button>

          {/* Notification Panel */}
          {showNotifications && (
            <div
              ref={notifPanelRef}
              className="absolute right-0 mt-2 w-80 md:w-96 bg-popover rounded-xl shadow-xl border border-border z-50 overflow-hidden flex flex-col max-h-[80vh]"
            >
              {/* Header */}
              <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-muted/40">
                <h3 className="font-semibold text-sm text-foreground">Notifikasi</h3>
                <div className="flex items-center gap-2">
                  {notificationCount > 0 && (
                    <>
                      <Badge variant="destructive" className="text-[10px]">{notificationCount} Baru</Badge>
                      <button
                        onClick={markAllAsRead}
                        className="text-[11px] text-primary hover:underline font-medium"
                      >
                        Tandai Semua
                      </button>
                    </>
                  )}
                  <button onClick={fetchNotifications} className="text-muted-foreground hover:text-foreground">
                    <RefreshCw size={13} className={loadingNotifs ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>

              {/* List */}
              <ScrollArea className="flex-1">
                {loadingNotifs ? (
                  <div className="p-6 text-center">
                    <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-primary mx-auto" />
                    <p className="mt-2 text-xs text-muted-foreground">Memuat...</p>
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="p-8 text-center">
                    <Bell size={28} className="mx-auto mb-2 text-muted-foreground/40" />
                    <p className="text-xs text-muted-foreground">Tidak ada notifikasi</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {notifications.map(notif => {
                      const isRead = readNotifications.has(notif.id);
                      return (
                        <button
                          key={notif.id}
                          onClick={() => { markAsRead(notif.id); setShowNotifications(false); window.location.href = notif.link; }}
                          className={cn(
                            'notif-item w-full text-left p-3 hover:bg-accent transition-colors',
                            priorityVariant[notif.priority],
                            isRead ? 'opacity-55' : ''
                          )}
                        >
                          <div className="flex gap-2.5">
                            <div className="mt-0.5 shrink-0">{getNotifIcon(notif.type)}</div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className={cn('text-xs text-foreground truncate', !isRead && 'font-semibold')}>
                                  {notif.title}
                                </p>
                                {!isRead && <span className="w-1.5 h-1.5 bg-primary rounded-full shrink-0" />}
                              </div>
                              <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{notif.message}</p>
                              <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                                {new Date(notif.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                              </p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </div>
          )}
        </div>

        {/* User */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={handleToggleUser}
            className="flex items-center gap-2 hover:bg-accent rounded-lg px-2 py-1.5 transition-colors"
          >
            <div className="text-right hidden sm:block">
              <p className="text-xs font-semibold text-foreground leading-tight">{userName}</p>
              {userRole && (
                <p className="text-[10px] text-muted-foreground">{formatRole(userRole)}</p>
              )}
            </div>
            <Avatar className="h-8 w-8 bg-primary">
              <AvatarFallback className="bg-primary text-primary-foreground text-xs font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>
          </button>

          {/* User Dropdown */}
          {showLogout && (
            <div
              ref={userPanelRef}
              className="absolute right-0 mt-2 w-52 bg-popover rounded-xl shadow-xl border border-border py-1.5 z-50"
            >
              <div className="px-3 py-2">
                <p className="text-xs font-semibold text-foreground truncate">{userName}</p>
                {userRole && <p className="text-[10px] text-muted-foreground mt-0.5">{formatRole(userRole)}</p>}
              </div>
              <Separator className="my-1" />
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-destructive/10 hover:text-destructive transition-colors rounded-md mx-auto"
              >
                <LogOut size={14} />
                <span>Logout</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

