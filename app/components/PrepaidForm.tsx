'use client';

import { toast } from 'sonner';
import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

interface PrepaidData {
  id?: number;
  companyCode: string;
  noPo: string;
  alokasi: string;
  kdAkr: string;
  namaAkun: string;
  deskripsi: string;
  klasifikasi: string;
  totalAmount: string;
  startDate: string;
  period: string;
  periodUnit: string;
  pembagianType: string;
  vendor: string;
  costCenter: string;
  headerText: string;
}

interface PrepaidFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editData?: any;
  mode?: 'create' | 'edit';
}

export default function PrepaidForm({ isOpen, onClose, onSuccess, editData, mode = 'create' }: PrepaidFormProps) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<PrepaidData>({
    companyCode: '',
    noPo: '',
    alokasi: '',
    kdAkr: '',
    namaAkun: '',
    deskripsi: '',
    klasifikasi: '',
    totalAmount: '',
    startDate: '',
    period: '',
    periodUnit: 'bulan',
    pembagianType: 'otomatis',
    vendor: '',
    costCenter: '',
    headerText: ''
  });

  // Load data when in edit mode
  useEffect(() => {
    if (mode === 'edit' && editData) {
      setFormData({
        id: editData.id,
        companyCode: editData.companyCode || '',
        noPo: editData.noPo || '',
        alokasi: editData.alokasi || '',
        kdAkr: editData.kdAkr || '',
        namaAkun: editData.namaAkun || '',
        deskripsi: editData.deskripsi || '',
        klasifikasi: editData.klasifikasi || '',
        totalAmount: editData.totalAmount?.toString() || '',
        startDate: editData.startDate?.split('T')[0] || '',
        period: editData.period?.toString() || '',
        periodUnit: editData.periodUnit || 'bulan',
        pembagianType: editData.pembagianType || 'otomatis',
        vendor: editData.vendor || '',
        costCenter: editData.costCenter || '',
        headerText: editData.headerText || ''
      });
    } else {
      // Reset form for create mode
      setFormData({
        companyCode: '',
        noPo: '',
        alokasi: '',
        kdAkr: '',
        namaAkun: '',
        deskripsi: '',
        klasifikasi: '',
        totalAmount: '',
        startDate: '',
        period: '',
        periodUnit: 'bulan',
        pembagianType: 'otomatis',
        vendor: '',
        costCenter: '',
        headerText: ''
      });
    }
  }, [mode, editData, isOpen]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const url = mode === 'edit' && formData.id 
        ? `/api/prepaid?id=${formData.id}` 
        : '/api/prepaid';
      
      const method = mode === 'edit' ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...formData,
          totalAmount: parseFloat(formData.totalAmount),
          period: parseInt(formData.period),
        }),
      });

      if (response.ok) {
        toast.success(`Data prepaid berhasil ${mode === 'edit' ? 'diupdate' : 'ditambahkan'}!`);
        onSuccess();
        onClose();
      } else {
        const error = await response.json();
        toast.error(`Error: ${error.error || 'Gagal menyimpan data'}`);
      }
    } catch (error) {
      console.error('Error submitting form:', error);
      toast.error('Terjadi kesalahan saat menyimpan data');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-gradient-to-br from-red-600 to-red-800 rounded-xl sm:rounded-2xl shadow-2xl max-w-5xl w-full max-h-[95vh] sm:max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 md:px-8 py-4 sm:py-5 md:py-6">
          <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-white">
            {mode === 'edit' ? 'Edit Data Prepaid' : 'Tambah Data Prepaid'}
          </h2>
          <button
            onClick={onClose}
            type="button"
            className="text-white hover:text-red-100 transition-colors rounded-full hover:bg-white/10 p-1"
          >
            <X size={24} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(95vh - 180px)' }}>
          <form onSubmit={handleSubmit} className="p-4 sm:p-6 bg-gray-50">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
              {/* Company Code */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-2">
                  Company Code
                </label>
                <select
                  name="companyCode"
                  value={formData.companyCode}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                >
                  <option value="">Pilih company code</option>
                  <option value="2000">2000</option>
                  <option value="7000">7000</option>
                </select>
              </div>

              {/* No PO */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-2">
                  No PO
                </label>
                <input
                  type="text"
                  name="noPo"
                  value={formData.noPo}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                  placeholder="Masukkan no PO"
                />
              </div>

              {/* Assignment/Order (Alokasi) */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-2">
                  Assignment/Order
                </label>
                <input
                  type="text"
                  name="alokasi"
                  value={formData.alokasi}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                  placeholder="Masukkan assignment/order"
                />
              </div>

              {/* Kode Akun Prepaid */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-2">
                  Kode Akun Prepaid
                </label>
                <select
                  name="kdAkr"
                  value={formData.kdAkr}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                >
                  <option value="">Pilih kode akun prepaid</option>
                  <option value="11830001">11830001</option>
                  <option value="11830009">11830009</option>
                  <option value="11830002">11830002</option>
                </select>
              </div>

              {/* Kode Akun Biaya */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-2">
                  Kode Akun Biaya
                </label>
                <input
                  type="text"
                  name="namaAkun"
                  value={formData.namaAkun}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                  placeholder="Contoh: Prepaid Insurance"
                />
              </div>

              {/* Klasifikasi */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-2">
                  Klasifikasi
                </label>
                <input
                  type="text"
                  name="klasifikasi"
                  value={formData.klasifikasi}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                  placeholder="Contoh: Insurance, Rent, Service"
                />
              </div>

              {/* Amount */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-2">
                  Amount
                </label>
                <input
                  type="number"
                  name="totalAmount"
                  value={formData.totalAmount}
                  onChange={handleChange}
                  min="0"
                  step="0.01"
                  className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                  placeholder="Total amount"
                />
              </div>

              {/* Start Date */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-2">
                  Start Date
                </label>
                <input
                  type="date"
                  name="startDate"
                  value={formData.startDate}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                />
              </div>

              {/* Jumlah Periode */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-2">
                  Jumlah Periode
                </label>
                <input
                  type="number"
                  name="period"
                  value={formData.period}
                  onChange={handleChange}
                  min="1"
                  max="36"
                  className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                  placeholder="Contoh: 12 (bulan)"
                />
              </div>

              {/* Pembagian Type */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-2">
                  Mode Amortisasi
                </label>
                <select
                  name="pembagianType"
                  value={formData.pembagianType}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                >
                  <option value="otomatis">Otomatis (dibagi rata, berjalan per bulan)</option>
                  <option value="manual">Manual (input amortisasi per periode)</option>
                </select>
              </div>

              {/* Cost Center */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-2">
                  Cost Center
                </label>
                <input
                  type="text"
                  name="costCenter"
                  value={formData.costCenter}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                  placeholder="Contoh: CC-001"
                />
              </div>

              {/* Header Text */}
              <div className="sm:col-span-2">
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-2">
                  Header Text (untuk jurnal SAP)
                </label>
                <input
                  type="text"
                  name="headerText"
                  value={formData.headerText}
                  onChange={handleChange}
                  className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                  placeholder="Header text untuk jurnal SAP"
                />
              </div>

              {/* Deskripsi */}
              <div className="sm:col-span-2">
                <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-2">
                  Deskripsi
                </label>
                <textarea
                  name="deskripsi"
                  value={formData.deskripsi}
                  onChange={handleChange}
                  rows={3}
                  className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none text-sm transition-all"
                  placeholder="Deskripsi prepaid"
                />
              </div>
            </div>

            {/* Form Actions */}
            <div className="flex items-center justify-end gap-2 sm:gap-3 pt-4 sm:pt-6 border-t border-gray-200 bg-white px-4 sm:px-6 py-3 sm:py-4 -mx-4 sm:-mx-6 -mb-4 sm:-mb-6 rounded-b-xl sm:rounded-b-2xl">
              <button
                type="button"
                onClick={onClose}
                className="px-3 sm:px-5 py-2 sm:py-2.5 text-xs sm:text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors"
                disabled={loading}
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-3 sm:px-5 py-2 sm:py-2.5 text-xs sm:text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-red-500/30"
              >
                {loading ? 'Menyimpan...' : mode === 'edit' ? 'Update Data' : 'Simpan Data'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
