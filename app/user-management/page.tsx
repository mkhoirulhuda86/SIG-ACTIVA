'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Users, Plus, Edit2, Trash2, Shield, Mail, User, X, Eye, EyeOff, CheckCircle, XCircle } from 'lucide-react';
import AuthGuard from '../components/AuthGuard';
import Header from '../components/Header';
import Sidebar from '../components/Sidebar';
import TableSkeleton from '../components/TableSkeleton';
import { useRealtimeUpdates } from '@/hooks/useRealtimeUpdates';

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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
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

  useEffect(() => {
    fetchUsers();
  }, []);

  // Realtime: refresh saat admin lain tambah/edit/approve/hapus user
  useRealtimeUpdates(['users'], () => { fetchUsers(); });

  const fetchUsers = useCallback(async () => {
    try {
      const response = await fetch('/api/users');
      const data = await response.json();
      if (data.success) {
        setUsers(data.users);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

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
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setIsEditing(false);
    setSelectedUser(null);
    setError('');
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
      'ADMIN_SYSTEM': 'bg-red-100 text-red-700',
      'STAFF_ACCOUNTING': 'bg-blue-100 text-blue-700',
      'SUPERVISOR_ACCOUNTING': 'bg-purple-100 text-purple-700',
      'AUDITOR_INTERNAL': 'bg-yellow-100 text-yellow-700',
      'STAFF_PRODUCTION': 'bg-green-100 text-green-700',
    };
    return colors[role] || 'bg-gray-100 text-gray-700';
  };

  return (
    <AuthGuard>
      <div className="flex min-h-screen bg-gray-50">
        {/* Mobile Sidebar Overlay */}
        {isMobileSidebarOpen && (
          <div 
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setIsMobileSidebarOpen(false)}
          />
        )}
        
        {/* Sidebar - Always rendered, controlled by transform */}
        <div className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ease-in-out ${
          isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}>
          <Sidebar onClose={() => setIsMobileSidebarOpen(false)} />
        </div>
        
        {/* Main Content */}
        <div className="flex-1 bg-gradient-to-br from-red-50 to-gray-100 lg:ml-64 overflow-x-hidden">
          {/* Header */}
          <Header 
            title="User Management" 
            subtitle="Kelola pengguna dan hak akses sistem"
            onMenuClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
          />
          
          <main className="p-3 sm:p-4 md:p-8">
            <div className="max-w-7xl mx-auto animate-fadeIn">
              {/* Action Button */}
              <div className="flex justify-end mb-4 sm:mb-6">
                <button
                  onClick={() => handleOpenModal()}
                  className="flex items-center gap-1 sm:gap-2 bg-red-600 hover:bg-red-700 text-white px-3 sm:px-4 md:px-6 py-2 sm:py-2.5 md:py-3 rounded-lg shadow-lg transition-colors font-medium text-xs sm:text-sm md:text-base"
                >
                  <Plus size={16} className="sm:w-[18px] sm:h-[18px] md:w-5 md:h-5" />
                  <span className="hidden sm:inline">Tambah User</span>
                  <span className="sm:hidden">Tambah</span>
                </button>
              </div>

              {/* Success Message */}
              {successMessage && (
                <div className="mb-4 sm:mb-6 bg-green-50 border border-green-200 text-green-700 px-3 sm:px-4 py-2 sm:py-3 rounded-lg text-xs sm:text-sm">
                  {successMessage}
                </div>
              )}

              {/* Users Table */}
              <div className="bg-white rounded-xl sm:rounded-2xl shadow-xl overflow-hidden hover-lift delay-200">
                <style jsx>{`
                  .custom-scrollbar::-webkit-scrollbar {
                    height: 8px;
                  }
                  .custom-scrollbar::-webkit-scrollbar-track {
                    background: #f1f5f9;
                    border-radius: 5px;
                  }
                  .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: #cbd5e1;
                    border-radius: 5px;
                  }
                  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: #94a3b8;
                  }
                `}</style>
                {isLoading ? (
                  <TableSkeleton />
                ) : (
                  <div className="overflow-x-auto custom-scrollbar" style={{ maxWidth: '100%' }}>
                    <table className="w-full min-w-[640px]">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="px-2 sm:px-3 md:px-6 py-2 sm:py-3 md:py-4 text-left text-xs font-semibold text-gray-600 uppercase">Username</th>
                          <th className="px-2 sm:px-3 md:px-6 py-2 sm:py-3 md:py-4 text-left text-xs font-semibold text-gray-600 uppercase hidden sm:table-cell">Email</th>
                          <th className="px-2 sm:px-3 md:px-6 py-2 sm:py-3 md:py-4 text-left text-xs font-semibold text-gray-600 uppercase">Nama</th>
                          <th className="px-2 sm:px-3 md:px-6 py-2 sm:py-3 md:py-4 text-left text-xs font-semibold text-gray-600 uppercase">Role</th>
                          <th className="px-2 sm:px-3 md:px-6 py-2 sm:py-3 md:py-4 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                          <th className="px-2 sm:px-3 md:px-6 py-2 sm:py-3 md:py-4 text-left text-xs font-semibold text-gray-600 uppercase hidden md:table-cell">Dibuat</th>
                          <th className="px-2 sm:px-3 md:px-6 py-2 sm:py-3 md:py-4 text-center text-xs font-semibold text-gray-600 uppercase">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {users.map((user, index) => (
                          <tr key={user.id} className="hover:bg-gray-50 transition-smooth" style={{ animationDelay: `${index * 50}ms` }}>
                            <td className="px-2 sm:px-3 md:px-6 py-2 sm:py-3 md:py-4 text-xs sm:text-sm text-gray-800 font-medium">{user.username}</td>
                            <td className="px-2 sm:px-3 md:px-6 py-2 sm:py-3 md:py-4 text-xs sm:text-sm text-gray-600 hidden sm:table-cell">{user.email}</td>
                            <td className="px-2 sm:px-3 md:px-6 py-2 sm:py-3 md:py-4 text-xs sm:text-sm text-gray-800">{user.name}</td>
                            <td className="px-2 sm:px-3 md:px-6 py-2 sm:py-3 md:py-4">
                              <span className={`inline-flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 md:px-3 py-0.5 sm:py-1 rounded-full text-xs font-medium ${getRoleBadgeColor(user.role)}`}>
                                <Shield size={12} className="sm:w-3 sm:h-3 md:w-3.5 md:h-3.5" />
                                <span className="hidden lg:inline">{getRoleLabel(user.role)}</span>
                                <span className="lg:hidden">{getRoleLabel(user.role).split(' ')[0]}</span>
                              </span>
                            </td>
                            <td className="px-2 sm:px-3 md:px-6 py-2 sm:py-3 md:py-4">
                              {user.isApproved ? (
                                <span className="inline-flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 md:px-3 py-0.5 sm:py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                  <CheckCircle size={12} className="sm:w-3.5 sm:h-3.5" />
                                  <span className="hidden sm:inline">Aktif</span>
                                  <span className="sm:hidden">✓</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 md:px-3 py-0.5 sm:py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
                                  <XCircle size={12} className="sm:w-3.5 sm:h-3.5" />
                                  <span className="hidden sm:inline">Pending</span>
                                  <span className="sm:hidden">!</span>
                                </span>
                              )}
                            </td>
                            <td className="px-2 sm:px-3 md:px-6 py-2 sm:py-3 md:py-4 text-xs sm:text-sm text-gray-600 hidden md:table-cell">
                              {new Date(user.createdAt).toLocaleDateString('id-ID')}
                            </td>
                            <td className="px-2 sm:px-3 md:px-6 py-2 sm:py-3 md:py-4">
                              <div className="flex items-center justify-center gap-1 sm:gap-2">
                                {!user.isApproved && (
                                  <button
                                    onClick={() => handleApprove(user.id, user.role)}
                                    className="p-1 sm:p-1.5 md:p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                    title="Setujui"
                                  >
                                    <CheckCircle size={16} className="sm:w-[18px] sm:h-[18px]" />
                                  </button>
                                )}
                                <button
                                  onClick={() => handleOpenModal(user)}
                                  className="p-1 sm:p-1.5 md:p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                  title="Edit"
                                >
                                  <Edit2 size={16} className="sm:w-[18px] sm:h-[18px]" />
                                </button>
                                <button
                                  onClick={() => handleDelete(user.id)}
                                  className="p-1 sm:p-1.5 md:p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                  title="Hapus"
                                >
                                  <Trash2 size={16} className="sm:w-[18px] sm:h-[18px]" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </main>
        </div>

        {/* Modal */}
        {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-4 animate-fadeIn">
            <div className="bg-white rounded-xl sm:rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden animate-scaleIn">
              {/* Modal Header */}
              <div className="bg-gradient-to-r from-red-600 to-red-700 px-4 sm:px-6 py-4 sm:py-6 flex items-center justify-between">
                <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-white">
                  {isEditing ? 'Edit User' : 'Tambah User Baru'}
                </h2>
                <button
                  onClick={handleCloseModal}
                  className="text-white hover:text-red-100 transition-colors rounded-full hover:bg-white/10 p-1"
                >
                  <X size={20} className="sm:w-6 sm:h-6" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="overflow-y-auto" style={{ maxHeight: 'calc(90vh - 140px)' }}>
                <form onSubmit={handleSubmit} className="p-3 sm:p-4 md:p-6 bg-gray-50">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 md:gap-6 mb-4 sm:mb-6">
                    {/* Username */}
                    <div>
                      <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1 sm:mb-2">
                        Username <span className="text-red-600">*</span>
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-2 sm:pl-3 flex items-center pointer-events-none">
                          <User size={16} className="sm:w-[18px] sm:h-[18px] text-gray-400" />
                        </div>
                        <input
                          type="text"
                          value={formData.username}
                          onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                          className="w-full pl-8 sm:pl-10 pr-3 sm:pr-4 py-2 sm:py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-xs sm:text-sm transition-all"
                          placeholder="Masukkan username"
                          required
                        />
                      </div>
                    </div>

                    {/* Email */}
                    <div>
                      <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1 sm:mb-2">
                        Email <span className="text-red-600">*</span>
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-2 sm:pl-3 flex items-center pointer-events-none">
                          <Mail size={16} className="sm:w-[18px] sm:h-[18px] text-gray-400" />
                        </div>
                        <input
                          type="email"
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                          className="w-full pl-8 sm:pl-10 pr-3 sm:pr-4 py-2 sm:py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-xs sm:text-sm transition-all"
                          placeholder="Masukkan email"
                          required
                        />
                      </div>
                    </div>

                    {/* Name */}
                    <div className="md:col-span-2">
                      <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1 sm:mb-2">
                        Nama Lengkap <span className="text-red-600">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full px-3 sm:px-4 py-2 sm:py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-xs sm:text-sm transition-all"
                        placeholder="Masukkan nama lengkap"
                        required
                      />
                    </div>

                    {/* Role */}
                    <div className="md:col-span-2">
                      <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1 sm:mb-2">
                        Role <span className="text-red-600">*</span>
                      </label>
                      <select
                        value={formData.role}
                        onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                        className="w-full px-3 sm:px-4 py-2 sm:py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-xs sm:text-sm transition-all"
                        required
                      >
                        {ROLES.map((role) => (
                          <option key={role.value} value={role.value}>
                            {role.label} - {role.description}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Password */}
                    <div className="md:col-span-2">
                      <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1 sm:mb-2">
                        Password {isEditing && <span className="text-gray-500 font-normal text-xs">(kosongkan jika tidak ingin mengubah)</span>}
                        {!isEditing && <span className="text-red-600">*</span>}
                      </label>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={formData.password}
                          onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                          className="w-full pr-10 sm:pr-12 px-3 sm:px-4 py-2 sm:py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-xs sm:text-sm transition-all"
                          placeholder={isEditing ? 'Opsional' : 'Minimal 6 karakter'}
                          required={!isEditing}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute inset-y-0 right-0 pr-2 sm:pr-3 flex items-center text-gray-400 hover:text-gray-600"
                        >
                          {showPassword ? <EyeOff size={16} className="sm:w-[18px] sm:h-[18px]" /> : <Eye size={16} className="sm:w-[18px] sm:h-[18px]" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Error Message */}
                  {error && (
                    <div className="bg-red-50 border border-red-200 text-red-600 px-3 sm:px-4 py-2 sm:py-3 rounded-lg text-xs sm:text-sm mb-4 sm:mb-6">
                      {error}
                    </div>
                  )}

                  {/* Modal Footer */}
                  <div className="flex gap-2 sm:gap-3 pt-3 sm:pt-4 border-t border-gray-200">
                    <button
                      type="button"
                      onClick={handleCloseModal}
                      className="flex-1 px-3 sm:px-4 md:px-6 py-2 sm:py-2.5 md:py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium text-xs sm:text-sm"
                    >
                      Batal
                    </button>
                    <button
                      type="submit"
                      className="flex-1 px-3 sm:px-4 md:px-6 py-2 sm:py-2.5 md:py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-medium shadow-lg hover:shadow-xl text-xs sm:text-sm"
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
    </AuthGuard>
  );
}
