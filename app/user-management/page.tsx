'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Users, Plus, Edit2, Trash2, Shield, Mail, User, X, Eye, EyeOff, CheckCircle, XCircle, UserCheck, UserX, Crown } from 'lucide-react';
import { gsap } from 'gsap';
import { animate, stagger } from 'animejs';
import AuthGuard from '../components/AuthGuard';
import { Skeleton } from '../components/ui/skeleton';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { useRealtimeUpdates } from '@/hooks/useRealtimeUpdates';

const Sidebar = dynamic(() => import('../components/Sidebar'), { ssr: false });
const Header  = dynamic(() => import('../components/Header'),  { ssr: false });

interface User {
  id: number;
  username: string;
  email: string;
  name: string;
  role: string;
  isApproved: boolean;
  createdAt: string;
  updatedAt: string;
}

interface UserFormData {
  username: string;
  email: string;
  name: string;
  role: string;
  password: string;
}

const ROLES = [
  { value: 'ADMIN_SYSTEM', label: 'Admin System', description: 'Kelola user, data, dan sistem' },
  { value: 'STAFF_ACCOUNTING', label: 'Staff Accounting', description: 'Kelola data, input, update, edit, hapus data, dan generate laporan' },
  { value: 'SUPERVISOR_ACCOUNTING', label: 'Supervisor Accounting', description: 'Monitoring data, review laporan, dan verifikasi hasil pencatatan' },
  { value: 'AUDITOR_INTERNAL', label: 'Auditor Internal', description: 'Akses baca untuk keperluan audit dan penelusuran data historis' },
  { value: 'STAFF_PRODUCTION', label: 'Staff Production', description: 'Mengakses dashboard dan laporan material' },
];

export default function UserManagementPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [formData, setFormData] = useState<UserFormData>({
    username: '',
    email: '',
    name: '',
    role: 'STAFF_ACCOUNTING',
    password: '',
  });
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // ── Animation refs ────────────────────────────────────────────────
  const pageRef        = useRef<HTMLDivElement>(null);
  const statsRef       = useRef<HTMLDivElement>(null);
  const tableCardRef   = useRef<HTMLDivElement>(null);
  const tableBodyRef   = useRef<HTMLTableSectionElement>(null);
  const modalRef       = useRef<HTMLDivElement>(null);
  const modalBoxRef    = useRef<HTMLDivElement>(null);
  const addBtnRef      = useRef<HTMLButtonElement>(null);
  const toastRef       = useRef<HTMLDivElement>(null);
  const errorRef       = useRef<HTMLDivElement>(null);

  // ── Merged stat state — ONE re-render per frame instead of 3 ──────
  const [stats, setStats] = useState({ total: 0, approved: 0, pending: 0 });

  // ── AbortController ref for in-flight fetch cancellation ──────────
  const fetchCtrl = useRef<AbortController | null>(null);

  // ── Table-row animation runs only on first load ───────────────────
  const tableAnimDone = useRef(false);

  // ── Debounce ref for SSE-triggered refreshes ──────────────────────
  const sseDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchUsers();
    return () => { fetchCtrl.current?.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime: debounce to avoid hammering API on rapid events
  useRealtimeUpdates(['users'], useCallback(() => {
    if (sseDebounce.current) clearTimeout(sseDebounce.current);
    sseDebounce.current = setTimeout(() => fetchUsers(), 400);
  }, []));

  const fetchUsers = useCallback(async () => {
    // Cancel any in-flight request before starting a new one
    fetchCtrl.current?.abort();
    const ctrl = new AbortController();
    fetchCtrl.current = ctrl;
    try {
      const response = await fetch('/api/users', { signal: ctrl.signal });
      const data = await response.json();
      if (data.success) {
        setUsers(data.users);
      }
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Error fetching users:', err);
      }
    } finally {
      if (!ctrl.signal.aborted) setIsLoading(false);
    }
  }, []);

  // ── Page entrance — runs once on mount (not gated on isLoading) ───
  useEffect(() => {
    // Use a small delay so DOM is fully painted
    const tid = setTimeout(() => {
      if (pageRef.current) {
        gsap.fromTo(pageRef.current,
          { opacity: 0, y: 16 },
          { opacity: 1, y: 0, duration: 0.55, ease: 'power3.out' }
        );
      }
    }, 80);
    return () => clearTimeout(tid);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Stat-cards + table card animate in when loading finishes ────────
  useEffect(() => {
    if (isLoading) return;
    const tid = setTimeout(() => {
      if (statsRef.current) {
        const cards = statsRef.current.querySelectorAll('[data-stat-card]');
        gsap.fromTo(cards,
          { opacity: 0, y: 28, scale: 0.95 },
          { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: 'power3.out', stagger: 0.08 }
        );
      }
      if (tableCardRef.current) {
        gsap.fromTo(tableCardRef.current,
          { opacity: 0, y: 32, scale: 0.98 },
          { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'power3.out', delay: 0.18 }
        );
      }
    }, 50);
    return () => clearTimeout(tid);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // ── Animate table rows + stat counters when users data arrives ────
  useEffect(() => {
    if (isLoading) return;

    const total    = users.length;
    const approved = users.filter(u => u.isApproved).length;
    const pending  = total - approved;

    // Animate table rows only on first load, not on every SSE refresh
    if (!tableAnimDone.current && tableBodyRef.current) {
      tableAnimDone.current = true;
      const rows = tableBodyRef.current.querySelectorAll('tr');
      gsap.killTweensOf(rows);
      gsap.fromTo(rows,
        { opacity: 0, x: -12 },
        { opacity: 1, x: 0, duration: 0.28, ease: 'expo.out', stagger: 0.03, delay: 0.3 }
      );
    }

    // Counter animation — single state update per frame (1× re-render instead of 3×)
    const proxy = { t: stats.total, a: stats.approved, p: stats.pending };
    animate(proxy, {
      t: total, a: approved, p: pending,
      duration: 800,
      ease: 'easeOutExpo',
      onUpdate: () => setStats({
        total: Math.round(proxy.t),
        approved: Math.round(proxy.a),
        pending: Math.round(proxy.p),
      }),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, isLoading]);

  // ── Add-button pulse when visible ────────────────────────────────
  useEffect(() => {
    if (isLoading || !addBtnRef.current) return;
    const tid = setTimeout(() => {
      if (addBtnRef.current) {
        gsap.fromTo(addBtnRef.current,
          { scale: 0.8, opacity: 0 },
          { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(2)' }
        );
      }
    }, 350);
    return () => clearTimeout(tid);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // ── Toast animation ────────────────────────────────────────────────
  useEffect(() => {
    if (!toastRef.current) return;
    if (successMessage) {
      gsap.fromTo(toastRef.current,
        { opacity: 0, y: -16, scale: 0.95 },
        { opacity: 1, y: 0, scale: 1, duration: 0.4, ease: 'back.out(1.6)' }
      );
    }
  }, [successMessage]);

  useEffect(() => {
    if (!errorRef.current) return;
    if (error) {
      gsap.fromTo(errorRef.current,
        { opacity: 0, x: -10 },
        { opacity: 1, x: 0, duration: 0.35, ease: 'power3.out' }
      );
    }
  }, [error]);

  const handleOpenModal = (user?: User) => {
    if (user) {
      setIsEditing(true);
      setSelectedUser(user);
      setFormData({
        username: user.username,
        email: user.email,
        name: user.name,
        role: user.role,
        password: '',
      });
    } else {
      setIsEditing(false);
      setSelectedUser(null);
      setFormData({
        username: '',
        email: '',
        name: '',
        role: 'STAFF_ACCOUNTING',
        password: '',
      });
    }
    setError('');
    setShowModal(true);
    // Animate modal in — gsap.set hides immediately, then fromTo reveals
    requestAnimationFrame(() => {
      if (modalRef.current && modalBoxRef.current) {
        gsap.set(modalRef.current, { opacity: 0 });
        gsap.set(modalBoxRef.current, { opacity: 0, scale: 0.88, y: 32 });
        gsap.to(modalRef.current, { opacity: 1, duration: 0.25, ease: 'power2.out' });
        gsap.to(modalBoxRef.current, { opacity: 1, scale: 1, y: 0, duration: 0.45, ease: 'back.out(1.7)', delay: 0.03 });
        // Stagger form fields in
        setTimeout(() => {
          if (!modalBoxRef.current) return;
          const fields = modalBoxRef.current.querySelectorAll('[data-field]');
          animate(fields, {
            opacity: [0, 1],
            translateY: [14, 0],
            duration: 380,
            delay: stagger(55, { start: 60 }),
            ease: 'easeOutExpo',
          });
        }, 80);
      }
    });
  };

  const handleCloseModal = () => {
    if (modalRef.current && modalBoxRef.current) {
      gsap.to(modalBoxRef.current, {
        opacity: 0, scale: 0.88, y: 24, duration: 0.3, ease: 'power3.in',
        onComplete: () => {
          setShowModal(false);
          setIsEditing(false);
          setSelectedUser(null);
          setError('');
        },
      });
      gsap.to(modalRef.current, { opacity: 0, duration: 0.3, ease: 'power2.in' });
    } else {
      setShowModal(false);
      setIsEditing(false);
      setSelectedUser(null);
      setError('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      let response;
      if (isEditing && selectedUser) {
        response = await fetch(`/api/users/${selectedUser.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });
      } else {
        if (!formData.password) {
          setError('Password harus diisi');
          return;
        }
        response = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });
      }

      const data = await response.json();

      if (data.success) {
        setSuccessMessage(isEditing ? 'User berhasil diupdate' : 'User berhasil ditambahkan');
        setTimeout(() => setSuccessMessage(''), 3000);
        tableAnimDone.current = false; // allow row re-animation after mutation
        handleCloseModal();
        fetchUsers();
      } else {
        setError(data.error || 'Terjadi kesalahan');
      }
    } catch (error) {
      console.error('Error saving user:', error);
      setError('Terjadi kesalahan server');
    }
  };

  const handleDelete = async (userId: number) => {
    if (!confirm('Apakah Anda yakin ingin menghapus user ini?')) {
      return;
    }

    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (data.success) {
        setSuccessMessage('User berhasil dihapus');
        setTimeout(() => setSuccessMessage(''), 3000);
        tableAnimDone.current = false;
        fetchUsers();
      } else {
        setError(data.error || 'Gagal menghapus user');
        setTimeout(() => setError(''), 3000);
      }
    } catch (error) {
      console.error('Error deleting user:', error);
      setError('Terjadi kesalahan server');
      setTimeout(() => setError(''), 3000);
    }
  };

  const handleApprove = async (userId: number, currentRole: string) => {
    try {
      const response = await fetch(`/api/users/${userId}/approve`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          isApproved: true,
          role: currentRole // Gunakan role yang sudah dipilih admin
        }),
      });

      const data = await response.json();

      if (data.success) {
        setSuccessMessage('User berhasil disetujui');
        setTimeout(() => setSuccessMessage(''), 3000);
        tableAnimDone.current = false;
        fetchUsers();
      } else {
        setError(data.error || 'Gagal menyetujui user');
        setTimeout(() => setError(''), 3000);
      }
    } catch (error) {
      console.error('Error approving user:', error);
      setError('Terjadi kesalahan server');
      setTimeout(() => setError(''), 3000);
    }
  };

  const getRoleLabel = (roleValue: string) => {
    const role = ROLES.find(r => r.value === roleValue);
    return role ? role.label : roleValue;
  };

  const getRoleBadgeColor = (role: string) => {
    const colors: { [key: string]: string } = {
      'ADMIN_SYSTEM': 'bg-red-100 text-red-700 border-red-200',
      'STAFF_ACCOUNTING': 'bg-blue-100 text-blue-700 border-blue-200',
      'SUPERVISOR_ACCOUNTING': 'bg-purple-100 text-purple-700 border-purple-200',
      'AUDITOR_INTERNAL': 'bg-yellow-100 text-yellow-700 border-yellow-200',
      'STAFF_PRODUCTION': 'bg-green-100 text-green-700 border-green-200',
    };
    return colors[role] || 'bg-gray-100 text-gray-700 border-gray-200';
  };

  // ── Shell helper ──────────────────────────────────────────────────
  const shell = (content: React.ReactNode) => (
    <div className="flex min-h-screen bg-gradient-to-br from-slate-50 to-red-50/30">
      {isMobileSidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setIsMobileSidebarOpen(false)} />
      )}
      <div className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ease-in-out ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <Sidebar onClose={() => setIsMobileSidebarOpen(false)} />
      </div>
      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen overflow-hidden">
        <Header
          title="User Management"
          subtitle="Kelola pengguna dan hak akses sistem"
          onMenuClick={() => setIsMobileSidebarOpen(true)}
        />
        {content}
      </div>
    </div>
  );

  // ── Single return — skeleton vs content inside one AuthGuard ───────
  return (
    <AuthGuard>
      {shell(
        isLoading ? (
          /* ── Skeleton ─────────────────────────────────────────── */
          <div className="flex-1 p-4 sm:p-6 md:p-8">
            {/* Stat cards skeleton */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
              {[1,2,3].map(i => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center gap-4">
                  <Skeleton className="h-12 w-12 rounded-xl flex-shrink-0" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-3 w-24 rounded" />
                    <Skeleton className="h-7 w-16 rounded" />
                  </div>
                </div>
              ))}
            </div>
            {/* Action button skeleton */}
            <div className="flex justify-end mb-4">
              <Skeleton className="h-10 w-36 rounded-lg" />
            </div>
            {/* Table skeleton */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              {/* Strip */}
              <div className="h-11 bg-gradient-to-r from-red-500 to-red-600 flex items-center px-5 gap-2">
                <Skeleton className="h-4 w-32 rounded bg-white/20" />
              </div>
              <div className="p-4 space-y-2.5">
                {/* Header row */}
                <div className="flex gap-3 pb-3 border-b border-gray-100">
                  {[2,3,2,2,1.5,1.5,1].map((w,i) => (
                    <Skeleton key={i} className={`h-3 rounded flex-${w > 1 ? '['+w+'_'+w+'_0]' : '[1_1_0]'}`} style={{ flex: w }} />
                  ))}
                </div>
                {/* Data rows */}
                {[...Array(6)].map((_,i) => (
                  <div key={i} className="flex gap-3 items-center py-0.5">
                    <div className="flex items-center gap-2" style={{ flex: 2 }}>
                      <Skeleton className="h-7 w-7 rounded-full flex-shrink-0" />
                      <Skeleton className="h-4 flex-1 rounded" />
                    </div>
                    <Skeleton className="h-4 rounded hidden sm:block" style={{ flex: 3 }} />
                    <Skeleton className="h-4 rounded" style={{ flex: 2 }} />
                    <Skeleton className="h-6 w-24 rounded-full" />
                    <Skeleton className="h-6 w-16 rounded-full" />
                    <Skeleton className="h-4 rounded hidden md:block" style={{ flex: 1.5 }} />
                    <div className="flex gap-1 justify-center" style={{ flex: 1 }}>
                      <Skeleton className="h-7 w-7 rounded-lg" />
                      <Skeleton className="h-7 w-7 rounded-lg" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* ── Main content ──────────────────────────────────────── */
          <div ref={pageRef} className="flex-1 p-3 sm:p-4 md:p-8">
            <div className="max-w-7xl mx-auto space-y-4 sm:space-y-6">

          {/* ── Stat Cards ──────────────────────────────────────── */}
          <div ref={statsRef} className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            {/* Total Users */}
            <div data-stat-card className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-4 hover:shadow-md transition-shadow"
              onMouseEnter={e => gsap.to(e.currentTarget, { y: -3, duration: 0.2, ease: 'power2.out' })}
              onMouseLeave={e => gsap.to(e.currentTarget, { y: 0, duration: 0.2, ease: 'power2.out' })}>
              <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                <Users size={22} className="text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium">Total User</p>
                <p className="text-2xl font-bold text-gray-800">{stats.total}</p>
              </div>
            </div>
            {/* Approved */}
            <div data-stat-card className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-4 hover:shadow-md transition-shadow"
              onMouseEnter={e => gsap.to(e.currentTarget, { y: -3, duration: 0.2, ease: 'power2.out' })}
              onMouseLeave={e => gsap.to(e.currentTarget, { y: 0, duration: 0.2, ease: 'power2.out' })}>
              <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
                <UserCheck size={22} className="text-green-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium">User Aktif</p>
                <p className="text-2xl font-bold text-green-700">{stats.approved}</p>
              </div>
            </div>
            {/* Pending */}
            <div data-stat-card className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-4 hover:shadow-md transition-shadow"
              onMouseEnter={e => gsap.to(e.currentTarget, { y: -3, duration: 0.2, ease: 'power2.out' })}
              onMouseLeave={e => gsap.to(e.currentTarget, { y: 0, duration: 0.2, ease: 'power2.out' })}>
              <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                <UserX size={22} className="text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium">Pending Approval</p>
                <p className="text-2xl font-bold text-amber-700">{stats.pending}</p>
              </div>
            </div>
          </div>

          {/* ── Action Bar ──────────────────────────────────────── */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Crown size={15} className="text-red-400" />
              <span className="hidden sm:inline">Manajemen pengguna &amp; hak akses</span>
            </div>
            <button
              ref={addBtnRef}
              onClick={() => handleOpenModal()}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-700 active:scale-95 text-white px-4 py-2.5 rounded-lg shadow-md hover:shadow-lg transition-all font-medium text-sm"
              onMouseEnter={e => gsap.to(e.currentTarget, { scale: 1.04, duration: 0.18, ease: 'power2.out' })}
              onMouseLeave={e => gsap.to(e.currentTarget, { scale: 1, duration: 0.18, ease: 'power2.out' })}
            >
              <Plus size={17} />
              <span className="hidden sm:inline">Tambah User</span>
              <span className="sm:hidden">Tambah</span>
            </button>
          </div>

          {/* ── Toast Success ────────────────────────────────────── */}
          {successMessage && (
            <div ref={toastRef} className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl text-sm flex items-center gap-2.5 shadow-sm">
              <CheckCircle size={16} className="flex-shrink-0" />
              {successMessage}
            </div>
          )}

          {/* ── Users Table ──────────────────────────────────────── */}
          <div ref={tableCardRef} className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden">
            <style jsx>{`
              .table-scrollbar::-webkit-scrollbar { height: 6px; }
              .table-scrollbar::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
              .table-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
              .table-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
            `}</style>

            {/* Table header strip */}
            <div className="bg-gradient-to-r from-red-600 to-red-700 px-4 sm:px-6 py-3 flex items-center gap-2">
              <Users size={17} className="text-white/80" />
              <span className="text-white font-semibold text-sm">Daftar Pengguna</span>
              <Badge variant="secondary" className="ml-auto bg-white/20 text-white border-0 text-xs">
                {users.length} user
              </Badge>
            </div>

            <div className="overflow-x-auto table-scrollbar">
              <table className="w-full min-w-[640px]">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-3 md:px-6 py-3 md:py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Username</th>
                    <th className="px-3 md:px-6 py-3 md:py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden sm:table-cell">Email</th>
                    <th className="px-3 md:px-6 py-3 md:py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Nama</th>
                    <th className="px-3 md:px-6 py-3 md:py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Role</th>
                    <th className="px-3 md:px-6 py-3 md:py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-3 md:px-6 py-3 md:py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">Dibuat</th>
                    <th className="px-3 md:px-6 py-3 md:py-4 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Aksi</th>
                  </tr>
                </thead>
                <tbody ref={tableBodyRef} className="divide-y divide-gray-100">
                  {users.map((user) => (
                    <tr
                      key={user.id}
                      className="hover:bg-red-50/40 transition-colors"
                      onMouseEnter={e => gsap.to(e.currentTarget, { x: 2, duration: 0.15, ease: 'power2.out' })}
                      onMouseLeave={e => gsap.to(e.currentTarget, { x: 0, duration: 0.15, ease: 'power2.out' })}
                    >
                      <td className="px-3 md:px-6 py-3 md:py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-red-400 to-red-600 flex items-center justify-center flex-shrink-0">
                            <span className="text-white text-xs font-bold">{user.username.charAt(0).toUpperCase()}</span>
                          </div>
                          <span className="text-sm text-gray-800 font-medium">{user.username}</span>
                        </div>
                      </td>
                      <td className="px-3 md:px-6 py-3 md:py-4 text-sm text-gray-500 hidden sm:table-cell">{user.email}</td>
                      <td className="px-3 md:px-6 py-3 md:py-4 text-sm text-gray-700">{user.name}</td>
                      <td className="px-3 md:px-6 py-3 md:py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${getRoleBadgeColor(user.role)}`}>
                          <Shield size={11} />
                          <span className="hidden lg:inline">{getRoleLabel(user.role)}</span>
                          <span className="lg:hidden">{getRoleLabel(user.role).split(' ')[0]}</span>
                        </span>
                      </td>
                      <td className="px-3 md:px-6 py-3 md:py-4">
                        {user.isApproved ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 border border-green-200">
                            <CheckCircle size={11} />
                            <span>Aktif</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200">
                            <XCircle size={11} />
                            <span>Pending</span>
                          </span>
                        )}
                      </td>
                      <td className="px-3 md:px-6 py-3 md:py-4 text-sm text-gray-500 hidden md:table-cell">
                        {new Date(user.createdAt).toLocaleDateString('id-ID')}
                      </td>
                      <td className="px-3 md:px-6 py-3 md:py-4">
                        <div className="flex items-center justify-center gap-1.5">
                          {!user.isApproved && (
                            <button
                              onClick={() => handleApprove(user.id, user.role)}
                              className="p-1.5 text-green-600 hover:bg-green-100 rounded-lg transition-colors"
                              title="Setujui"
                              onMouseEnter={e => gsap.to(e.currentTarget, { scale: 1.2, duration: 0.15, ease: 'back.out(2)' })}
                              onMouseLeave={e => gsap.to(e.currentTarget, { scale: 1, duration: 0.15, ease: 'power2.out' })}
                            >
                              <CheckCircle size={16} />
                            </button>
                          )}
                          <button
                            onClick={() => handleOpenModal(user)}
                            className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors"
                            title="Edit"
                            onMouseEnter={e => gsap.to(e.currentTarget, { scale: 1.2, duration: 0.15, ease: 'back.out(2)' })}
                            onMouseLeave={e => gsap.to(e.currentTarget, { scale: 1, duration: 0.15, ease: 'power2.out' })}
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => handleDelete(user.id)}
                            className="p-1.5 text-red-500 hover:bg-red-100 rounded-lg transition-colors"
                            title="Hapus"
                            onMouseEnter={e => gsap.to(e.currentTarget, { scale: 1.2, duration: 0.15, ease: 'back.out(2)' })}
                            onMouseLeave={e => gsap.to(e.currentTarget, { scale: 1, duration: 0.15, ease: 'power2.out' })}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-16 text-center text-gray-400 text-sm">
                        Belum ada data pengguna.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ── Modal ────────────────────────────────────────────────── */}
        {showModal && (
          <div
            ref={modalRef}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-4"
          >
            <div
              ref={modalBoxRef}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden"
            >
              {/* Modal Header */}
              <div className="bg-gradient-to-r from-red-600 to-red-700 px-5 sm:px-6 py-4 sm:py-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                    {isEditing ? <Edit2 size={16} className="text-white" /> : <Plus size={16} className="text-white" />}
                  </div>
                  <h2 className="text-base sm:text-lg md:text-xl font-bold text-white">
                    {isEditing ? 'Edit User' : 'Tambah User Baru'}
                  </h2>
                </div>
                <button
                  onClick={handleCloseModal}
                  className="text-white/80 hover:text-white transition-colors rounded-full hover:bg-white/10 p-1.5"
                  onMouseEnter={e => gsap.to(e.currentTarget, { rotate: 90, duration: 0.25, ease: 'power2.out' })}
                  onMouseLeave={e => gsap.to(e.currentTarget, { rotate: 0, duration: 0.25, ease: 'power2.out' })}
                >
                  <X size={20} />
                </button>
              </div>

              <Separator />

              {/* Modal Body */}
              <div className="overflow-y-auto" style={{ maxHeight: 'calc(90vh - 148px)' }}>
                <form onSubmit={handleSubmit} className="p-4 sm:p-6 bg-gray-50/50">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5 mb-5">
                    {/* Username */}
                    <div data-field>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                        Username <span className="text-red-500 normal-case">*</span>
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <User size={15} className="text-gray-400" />
                        </div>
                        <input
                          type="text"
                          value={formData.username}
                          onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                          className="w-full pl-9 pr-3 py-2.5 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-400 text-sm transition-all shadow-sm"
                          placeholder="Masukkan username"
                          required
                        />
                      </div>
                    </div>

                    {/* Email */}
                    <div data-field>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                        Email <span className="text-red-500 normal-case">*</span>
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <Mail size={15} className="text-gray-400" />
                        </div>
                        <input
                          type="email"
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                          className="w-full pl-9 pr-3 py-2.5 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-400 text-sm transition-all shadow-sm"
                          placeholder="Masukkan email"
                          required
                        />
                      </div>
                    </div>

                    {/* Nama */}
                    <div className="md:col-span-2" data-field>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                        Nama Lengkap <span className="text-red-500 normal-case">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-400 text-sm transition-all shadow-sm"
                        placeholder="Masukkan nama lengkap"
                        required
                      />
                    </div>

                    {/* Role */}
                    <div className="md:col-span-2" data-field>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                        Role <span className="text-red-500 normal-case">*</span>
                      </label>
                      <select
                        value={formData.role}
                        onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                        className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-400 text-sm transition-all shadow-sm"
                        required
                      >
                        {ROLES.map((role) => (
                          <option key={role.value} value={role.value}>
                            {role.label} — {role.description}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Password */}
                    <div className="md:col-span-2" data-field>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                        Password{' '}
                        {isEditing
                          ? <span className="text-gray-400 font-normal normal-case text-xs">(kosongkan jika tidak ingin mengubah)</span>
                          : <span className="text-red-500 normal-case">*</span>
                        }
                      </label>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={formData.password}
                          onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                          className="w-full pr-11 px-3 py-2.5 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-400 text-sm transition-all shadow-sm"
                          placeholder={isEditing ? 'Opsional' : 'Minimal 6 karakter'}
                          required={!isEditing}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Error */}
                  {error && (
                    <div ref={errorRef} className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm mb-5 flex items-center gap-2">
                      <XCircle size={15} className="flex-shrink-0" />
                      {error}
                    </div>
                  )}

                  {/* Footer Buttons */}
                  <Separator className="mb-4" />
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={handleCloseModal}
                      className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-100 transition-colors font-medium text-sm"
                    >
                      Batal
                    </button>
                    <button
                      type="submit"
                      className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-all font-medium shadow-md hover:shadow-lg text-sm active:scale-95"
                      onMouseEnter={e => gsap.to(e.currentTarget, { scale: 1.02, duration: 0.15, ease: 'power2.out' })}
                      onMouseLeave={e => gsap.to(e.currentTarget, { scale: 1, duration: 0.15, ease: 'power2.out' })}
                    >
                      {isEditing ? 'Update User' : 'Tambah User'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
        )
      )}
    </AuthGuard>
  );
}
