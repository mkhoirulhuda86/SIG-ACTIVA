'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, Download, Plus, MoreVertical, X, Edit2, Trash2, Upload, ChevronDown, ChevronRight } from 'lucide-react';
import dynamic from 'next/dynamic';
import { exportToCSV } from '../utils/exportUtils';
import { KODE_AKUN_KLASIFIKASI } from '../utils/accrualKlasifikasi';
import { useRealtimeUpdates } from '@/hooks/useRealtimeUpdates';

// Lazy load components yang tidak critical untuk initial render
const Sidebar = dynamic(() => import('../components/Sidebar'), { 
  ssr: false,
  loading: () => <div className="w-64 bg-gray-900 animate-pulse" />
});
const Header = dynamic(() => import('../components/Header'), {
  ssr: false,
  loading: () => <div className="h-20 bg-white border-b animate-pulse" />
});

// Lazy load Excel libraries untuk mengurangi bundle size awal
let XLSX: any = null;
let ExcelJS: any = null;

const loadExcelLibraries = async () => {
  if (!XLSX) {
    XLSX = (await import('xlsx')).default;
  }
  if (!ExcelJS) {
    ExcelJS = (await import('exceljs')).default;
  }
  return { XLSX, ExcelJS };
};

interface AccrualPeriode {
  id: number;
  periodeKe: number;
  bulan: string;
  tahun: number;
  amountAccrual: number;
  totalRealisasi?: number;
  saldo?: number;
  realisasis?: RealisasiData[];
  costcenters?: CostCenterEntry[];
}

interface CostCenterEntry {
  id: number;
  costCenter?: string;
  kdAkunBiaya?: string;
  amount: number;
  headerText?: string;
  lineText?: string;
  keterangan?: string;
}

interface Accrual {
  id: number;
  companyCode?: string;
  noPo?: string;
  kdAkr: string;
  alokasi?: string;
  kdAkunBiaya: string;
  vendor: string;
  deskripsi: string;
  headerText?: string;
  klasifikasi?: string;
  totalAmount: number;
  saldoAwal?: number | null;
  costCenter?: string;
  startDate: string;
  jumlahPeriode: number;
  pembagianType: string;
  periodes?: AccrualPeriode[];
}

interface AccrualFormData {
  companyCode: string;
  noPo: string;
  assignment: string;
  kdAkr: string;
  kdAkunBiaya: string;
  vendor: string;
  deskripsi: string;
  headerText: string;
  klasifikasi: string;
  totalAmount: string;
  saldoAwal: string;
  costCenter: string;
  startDate: string;
  jumlahPeriode: string;
  pembagianType: string;
  periodeAmounts: string[];
}

interface RealisasiFormData {
  tanggalRealisasi: string;
  amount: string;
  headerText: string;
  lineText: string;
  keterangan: string;
  kdAkunBiaya: string;
  costCenter: string;
}

interface RealisasiData {
  id: number;
  tanggalRealisasi: string;
  amount: number;
  headerText?: string;
  lineText?: string;
  keterangan?: string;
  kdAkunBiaya?: string;
  costCenter?: string;
}

// Saldo awal: nilai tetap dari import (saldo akhir/outstanding). Tidak ada logika periode — tidak berubah saat periode berganti.
function getSaldoAwal(item: Accrual): number {
  if (item.saldoAwal != null && item.saldoAwal !== undefined) return Number(item.saldoAwal);
  return Math.abs(item.totalAmount ?? 0);
}

// Saldo = saldo awal + total accrual - realisasi
function calculateItemSaldo(item: Accrual, totalAccrual: number, totalRealisasi: number): number {
  const saldoAwal = getSaldoAwal(item);
  return saldoAwal + totalAccrual - totalRealisasi;
}

// Total Accrual: logika lama — hanya periode yang sudah jatuh tempo ATAU yang punya realisasi efektif (dengan rollover) yang diakui
function calculateAccrualAmount(item: Accrual): number {
  if (!item.periodes || item.periodes.length === 0) return 0;

  if (item.pembagianType === 'manual') {
    return item.periodes.reduce((sum, p) => sum + Math.abs(p.amountAccrual), 0);
  }

  const today = new Date();
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const bulanMap: Record<string, number> = {
    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'Mei': 4, 'Jun': 5,
    'Jul': 6, 'Agu': 7, 'Sep': 8, 'Okt': 9, 'Nov': 10, 'Des': 11
  };

  let totalAccrual = 0;
  let rollover = 0;

  for (let i = 0; i < item.periodes.length; i++) {
    const p = item.periodes[i];
    const [bulanName, tahunStr] = p.bulan.split(' ');
    const periodeBulan = bulanMap[bulanName];
    const periodeTahun = parseInt(tahunStr);
    const periodeDateOnly = new Date(periodeTahun, periodeBulan, 1);

    const realisasiPeriode = p.totalRealisasi ?? 0;
    const totalAvailable = realisasiPeriode + rollover;
    const capAccrual = Math.abs(p.amountAccrual);
    const effectiveRealisasi = Math.min(totalAvailable, capAccrual);
    const newRollover = Math.max(0, totalAvailable - capAccrual);

    const isPeriodDue = todayDate >= periodeDateOnly;
    const hasEffectiveRealisasi = effectiveRealisasi > 0;
    const shouldRecognize = isPeriodDue || hasEffectiveRealisasi;

    if (shouldRecognize) {
      totalAccrual += Math.abs(p.amountAccrual);
    }

    rollover = newRollover;
  }

  return totalAccrual;
}

export default function MonitoringAccrualPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterType, setFilterType] = useState('All');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [accrualData, setAccrualData] = useState<Accrual[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [userRole, setUserRole] = useState<string>('');
  const [isRoleLoaded, setIsRoleLoaded] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<number | string>>(new Set());
  const [expandedKodeAkun, setExpandedKodeAkun] = useState<Set<string>>(new Set());
  const [expandedVendor, setExpandedVendor] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [formData, setFormData] = useState<AccrualFormData>({
    companyCode: '',
    noPo: '',
    assignment: '',
    kdAkr: '',
    kdAkunBiaya: '',
    vendor: '',
    deskripsi: '',
    headerText: '',
    klasifikasi: '',
    totalAmount: '',
    saldoAwal: '',
    costCenter: '',
    startDate: '',
    jumlahPeriode: '12',
    pembagianType: 'otomatis',
    periodeAmounts: [],
  });
  const [submitting, setSubmitting] = useState(false);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [showRealisasiModal, setShowRealisasiModal] = useState(false);
  const [selectedPeriode, setSelectedPeriode] = useState<AccrualPeriode | null>(null);
  const [realisasiViewOnly, setRealisasiViewOnly] = useState(false);
  const [realisasiData, setRealisasiData] = useState<RealisasiData[]>([]);
  const [loadingRealisasiData, setLoadingRealisasiData] = useState(false);
  const [currentAccrualItem, setCurrentAccrualItem] = useState<Accrual | null>(null);
  const [realisasiForm, setRealisasiForm] = useState<RealisasiFormData>({
    tanggalRealisasi: new Date().toISOString().split('T')[0],
    amount: '',
    headerText: '',
    lineText: '',
    keterangan: '',
    kdAkunBiaya: '',
    costCenter: '',
  });
  const [submittingRealisasi, setSubmittingRealisasi] = useState(false);
  const [editingRealisasiId, setEditingRealisasiId] = useState<number | null>(null);
  const [editingPeriodeId, setEditingPeriodeId] = useState<number | null>(null);
  const [editPeriodeAmount, setEditPeriodeAmount] = useState<string>('');
  const [uploadingExcel, setUploadingExcel] = useState(false);
  const [showImportGlobalModal, setShowImportGlobalModal] = useState(false);
  const [uploadingGlobalExcel, setUploadingGlobalExcel] = useState(false);
  const [showImportExcelModal, setShowImportExcelModal] = useState(false);
  const [uploadingImportExcel, setUploadingImportExcel] = useState(false);
  const [expandedCostElements, setExpandedCostElements] = useState<Set<string>>(new Set());
  const [selectedRealisasiIds, setSelectedRealisasiIds] = useState<Set<number>>(new Set());
  const [deletingBulkRealisasi, setDeletingBulkRealisasi] = useState(false);
  // State untuk modal Rincian Accrual per Cost Center
  const [showCostCenterModal, setShowCostCenterModal] = useState(false);
  const [costCenterModalPeriode, setCostCenterModalPeriode] = useState<AccrualPeriode | null>(null);
  const [costCenterModalAccrual, setCostCenterModalAccrual] = useState<Accrual | null>(null);
  const [costCenterData, setCostCenterData] = useState<CostCenterEntry[]>([]);
  const [loadingCostCenterData, setLoadingCostCenterData] = useState(false);
  const [costCenterForm, setCostCenterForm] = useState({ costCenter: '', kdAkunBiaya: '', amount: '', headerText: '', lineText: '', keterangan: '' });
  const [editingCostCenterId, setEditingCostCenterId] = useState<number | null>(null);
  const [submittingCostCenter, setSubmittingCostCenter] = useState(false);
  const [selectedCostCenterIds, setSelectedCostCenterIds] = useState<Set<number>>(new Set());
  const [deletingBulkCostCenter, setDeletingBulkCostCenter] = useState(false);
  const [uploadingCostCenterFile, setUploadingCostCenterFile] = useState(false);
  const [expandedCostCenterGroups, setExpandedCostCenterGroups] = useState<Set<string>>(new Set());
  // Portal dropdown untuk jurnal group rincian accrual
  const [openCostCenterGroupDropdown, setOpenCostCenterGroupDropdown] = useState<{
    key: string;
    items: CostCenterEntry[];
    accrualItem: Accrual;
    rect: { top: number; right: number };
  } | null>(null);
  // Dialog header/line text untuk jurnal realisasi
  const [showJurnalHeaderModal, setShowJurnalHeaderModal] = useState(false);
  const [jurnalHeaderInput, setJurnalHeaderInput] = useState('');
  const [jurnalLineInput, setJurnalLineInput] = useState('');
  const [jurnalPendingCallback, setJurnalPendingCallback] = useState<((h: string, l: string) => void) | null>(null);
  // Portal dropdown Jurnal SAP (agar tidak tertutup header tabel)
  const [openJurnalRect, setOpenJurnalRect] = useState<{ top: number; right: number; bottom: number; left: number } | null>(null);
  const [openJurnalItem, setOpenJurnalItem] = useState<Accrual | null>(null);
  // State untuk dropdown jurnal per kode akun
  const [openKodeAkunDropdown, setOpenKodeAkunDropdown] = useState<string | null>(null);
  // Portal dropdown untuk jurnal group cost element (agar tidak terclip overflow-hidden)
  const [openGroupDropdown, setOpenGroupDropdown] = useState<{
    key: string;
    items: RealisasiData[];
    accrualItem: Accrual;
    rect: { top: number; right: number };
  } | null>(null);

  const closeJurnalDropdown = useCallback(() => {
    setOpenJurnalRect(null);
    setOpenJurnalItem(null);
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.forEach(id => { if (typeof id === 'string' && id.startsWith('jurnal-')) next.delete(id); });
      return next;
    });
  }, []);

  // Get available klasifikasi based on selected kode akun
  const availableKlasifikasi = useMemo(() => {
    if (!formData.kdAkr) return [];
    return KODE_AKUN_KLASIFIKASI[formData.kdAkr] || [];
  }, [formData.kdAkr]);

  // Debounce search term for better performance
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      
      // Close all jurnal dropdowns
      document.querySelectorAll('[id^="jurnal-dropdown-"]').forEach(dropdown => {
        if (!dropdown.contains(target) && !target.closest('button')) {
          dropdown.classList.add('hidden');
        }
      });
      
      document.querySelectorAll('[id^="jurnal-realisasi-dropdown-"]').forEach(dropdown => {
        if (!dropdown.contains(target) && !target.closest('button')) {
          dropdown.classList.add('hidden');
        }
      });
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Load user role from localStorage
  useEffect(() => {
    const role = localStorage.getItem('userRole') || '';
    console.log('User Role loaded:', role);
    setUserRole(role);
    setIsRoleLoaded(true);
  }, []);

  // Check if user can edit (only ADMIN_SYSTEM and STAFF_ACCOUNTING)
  const canEdit = userRole === 'ADMIN_SYSTEM' || userRole === 'STAFF_ACCOUNTING';
  
  // Debug log untuk memastikan nilai
  useEffect(() => {
    if (isRoleLoaded) {
      console.log('Can Edit:', canEdit, 'User Role:', userRole);
    }
  }, [canEdit, userRole, isRoleLoaded]);

  // Helper function to calculate accrual (memoized for better performance)
  const calculateItemAccrual = useCallback((item: Accrual) => {
    return calculateAccrualAmount(item);
  }, []);

  // Helper function to calculate periode allocations with rollover
  const calculatePeriodeAllocations = useCallback((periodes: AccrualPeriode[]) => {
    if (!periodes || periodes.length === 0) return [];
    
    let rollover = 0;
    const capAccrual = (p: AccrualPeriode) => Math.abs(p.amountAccrual);
    return periodes.map((periode) => {
      const realisasiPeriode = periode.totalRealisasi || 0;
      const totalAvailable = realisasiPeriode + rollover;
      const effectiveRealisasi = Math.min(totalAvailable, capAccrual(periode));
      const accrualAbs = Math.abs(periode.amountAccrual);
      const saldo = accrualAbs - effectiveRealisasi; // Saldo = accrual dikurangi realisasi (semua positif)
      const rolloverOut = Math.max(0, totalAvailable - capAccrual(periode));
      
      const result = {
        ...periode,
        totalRealisasi: effectiveRealisasi,
        saldo
      };
      
      rollover = rolloverOut;
      return result;
    });
  }, []);

  // Helper function to calculate realisasi (memoized) - uses effective realisasi with rollover
  const calculateItemRealisasi = useCallback((item: Accrual) => {
    if (!item.periodes || item.periodes.length === 0) return 0;
    let rollover = 0;
    let total = 0;
    for (const periode of item.periodes) {
      const realisasiPeriode = periode.totalRealisasi || 0;
      const totalAvailable = realisasiPeriode + rollover;
      const capAccrual = Math.abs(periode.amountAccrual);
      const effectiveRealisasi = Math.min(totalAvailable, capAccrual);
      total += effectiveRealisasi;
      rollover = Math.max(0, totalAvailable - capAccrual);
    }
    return total;
  }, []);

  // Helper function to calculate actual realisasi (sum of all realisasi amounts without rollover)
  const calculateActualRealisasi = useCallback((item: Accrual) => {
    if (!item.periodes || item.periodes.length === 0) return 0;
    
    return item.periodes.reduce((total, periode) => {
      // Sum all realisasi amounts from database (already positive)
      return total + (periode.totalRealisasi || 0);
    }, 0);
  }, []);

  // Fetch accrual data
  useEffect(() => {
    fetchAccrualData();
  }, []);

  const fetchAccrualData = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/accrual?t=' + Date.now());
      if (!response.ok) throw new Error('Failed to fetch data');
      const data = await response.json();
      setAccrualData(data);
    } catch (error) {
      console.error('Error fetching accrual data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Realtime: refresh list when another user mutates accrual/realisasi data
  useRealtimeUpdates(['accrual'], () => { fetchAccrualData(); });

  // Format currency: tanda negatif langsung di depan angka (Rp -11.045.599.003) agar tidak membingungkan
  const formatCurrency = useCallback((amount: number) => {
    const isNegative = amount < 0;
    const absAmount = Math.abs(amount);
    const numberPart = new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(absAmount);
    return isNegative ? `Rp -${numberPart}` : `Rp ${numberPart}`;
  }, []);

  // Calculate totals (optimized with useMemo)
  const totalAccrual = useMemo(() => {
    return accrualData.reduce((sum, item) => sum + item.totalAmount, 0);
  }, [accrualData]);
  
  const totalPeriodes = useMemo(() => {
    return accrualData.reduce((sum, item) => sum + (item.periodes?.length || 0), 0);
  }, [accrualData]);

  // Filter data (optimized with debounced search and cached toLowerCase)
  const filteredData = useMemo(() => {
    if (debouncedSearchTerm === '') return accrualData;
    
    const searchLower = debouncedSearchTerm.toLowerCase();
    return accrualData.filter(item => {
      return item.kdAkr.toLowerCase().includes(searchLower) ||
        item.kdAkunBiaya.toLowerCase().includes(searchLower) ||
        item.vendor.toLowerCase().includes(searchLower) ||
        item.deskripsi.toLowerCase().includes(searchLower);
    });
  }, [accrualData, debouncedSearchTerm]);

  // Group data by kode akun accrual, then by vendor (dengan pre-calculated totals)
  const groupedByKodeAkun = useMemo(() => {
    const groups: Record<string, Record<string, Accrual[]>> = {};
    filteredData.forEach(item => {
      if (!groups[item.kdAkr]) {
        groups[item.kdAkr] = {};
      }
      if (!groups[item.kdAkr][item.vendor]) {
        groups[item.kdAkr][item.vendor] = [];
      }
      groups[item.kdAkr][item.vendor].push(item);
    });
    return groups;
  }, [filteredData]);

  // Pre-calculate totals untuk setiap item (cache untuk performa)
  const itemTotalsCache = useMemo(() => {
    const cache = new Map<number, { accrual: number; realisasi: number; saldoAwal: number }>();
    filteredData.forEach(item => {
      const accrual = calculateItemAccrual(item);
      const realisasi = calculateActualRealisasi(item);
      const saldoAwal = getSaldoAwal(item);
      cache.set(item.id, {
        accrual,
        realisasi,
        saldoAwal,
      });
    });
    return cache;
  }, [filteredData, calculateItemAccrual, calculateActualRealisasi]);

  // Calculate total saldo for metric card (saldo awal + total accrual - total realisasi)
  const totalSaldo = useMemo(() => {
    return accrualData.reduce((sum, item) => {
      const cached = itemTotalsCache.get(item.id);
      if (cached) {
        return sum + (cached.saldoAwal + cached.accrual - cached.realisasi);
      }
      const saldoAwal = getSaldoAwal(item);
      const accrual = calculateItemAccrual(item);
      const realisasi = calculateItemRealisasi(item);
      return sum + (saldoAwal + accrual - realisasi);
    }, 0);
  }, [accrualData, itemTotalsCache]);

  const handleExport = () => {
    const headers = ['kdAkr', 'namaAkun', 'vendor', 'deskripsi', 'amount', 'accrDate', 'status'];
    exportToCSV(filteredData, 'Monitoring_Accrual.csv', headers);
  };

  const handleDownloadAllItemsReport = async () => {
    try {
      // Load ExcelJS on demand
      const { ExcelJS: ExcelJSLib } = await loadExcelLibraries();
      const workbook = new ExcelJSLib.Workbook();
      const worksheet = workbook.addWorksheet('Detail All Accruals');
    
    // Headers
    worksheet.getRow(1).height = 30;
    const headers = ['KODE AKUN', 'KLASIFIKASI', 'PEKERJAAN', 'VENDOR', 'PO/PR', 'ORDER', 'KETERANGAN', 'NILAI PO', 'DOC DATE', 'DELIV DATE', 'OUSTANDING'];
    
    worksheet.getRow(1).values = headers;
    worksheet.getRow(1).eachCell((cell: any) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF404040' }
      };
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });
    
    // Column widths
    worksheet.columns = [
      { width: 12 },  // KODE AKUN
      { width: 15 },  // KLASIFIKASI
      { width: 12 },  // PEKERJAAN
      { width: 35 },  // VENDOR
      { width: 15 },  // PO/PR
      { width: 15 },  // ORDER
      { width: 45 },  // KETERANGAN
      { width: 15 },  // NILAI PO
      { width: 12 },  // DOC DATE
      { width: 12 },  // DELIV DATE
      { width: 15 }   // OUSTANDING
    ];
    
    let currentRow = 2;
    
    // Loop through all items
    Object.entries(groupedByKodeAkun).forEach(([kodeAkun, vendorGroups]) => {
      Object.entries(vendorGroups).forEach(([vendor, items]) => {
        items.forEach((item) => {
          // Saldo = saldo awal + total accrual - realisasi (outstanding)
          const totalAccrual = calculateAccrualAmount(item);
          const totalRealisasi = calculateItemRealisasi(item);
          const totalOutstanding = calculateItemSaldo(item, totalAccrual, totalRealisasi);
          
          const row = worksheet.getRow(currentRow);
          
          row.getCell(1).value = item.kdAkr;
          row.getCell(2).value = item.klasifikasi?.toUpperCase() || 'TRANSPORTATION';
          row.getCell(3).value = item.klasifikasi || 'OA';
          row.getCell(4).value = item.vendor;
          row.getCell(5).value = item.noPo || '';
          row.getCell(6).value = item.alokasi || '';
          row.getCell(7).value = item.deskripsi;
          row.getCell(8).value = item.totalAmount;
          row.getCell(8).numFmt = '#,##0.000';
          
          // DOC DATE
          const docDate = new Date(item.startDate);
          row.getCell(9).value = `${docDate.getDate().toString().padStart(2, '0')}/${(docDate.getMonth() + 1).toString().padStart(2, '0')}/${docDate.getFullYear()}`;
          
          // DELIV DATE
          const endDate = new Date(item.startDate);
          endDate.setMonth(endDate.getMonth() + item.jumlahPeriode);
          row.getCell(10).value = `${endDate.getDate().toString().padStart(2, '0')}/${(endDate.getMonth() + 1).toString().padStart(2, '0')}/${endDate.getFullYear()}`;
          
          // OUTSTANDING
          row.getCell(11).value = totalOutstanding;
          row.getCell(11).numFmt = '#,##0.000';
          
          // Apply borders and styling
          for (let col = 1; col <= 11; col++) {
            const cell = row.getCell(col);
            cell.border = {
              top: { style: 'thin' },
              left: { style: 'thin' },
              bottom: { style: 'thin' },
              right: { style: 'thin' }
            };
            
            if (col === 8 || col === 11) {
              cell.alignment = { horizontal: 'right', vertical: 'middle' };
            } else {
              cell.alignment = { horizontal: 'left', vertical: 'middle' };
            }
          }
          
          currentRow++;
        });
      });
    });
    
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { 
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Detail_All_Accruals_${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error generating report:', error);
      alert('Gagal membuat laporan. Silakan coba lagi.');
    }
  };

  const handleDownloadGlobalReport = async () => {
    try {
      // Load ExcelJS on demand
      const { ExcelJS: ExcelJSLib } = await loadExcelLibraries();
      const workbook = new ExcelJSLib.Workbook();
    const worksheet = workbook.addWorksheet('Rekap Akrual');
    
    // Title - "Kebutuhan lain rekon akru utang AU exclude 21600001 dan 21600020 (SDM)"
    worksheet.mergeCells('A1:C1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'Kebutuhan lain rekon akru utang AU exclude 21600001 dan 21600020 (SDM)';
    titleCell.font = { name: 'Calibri', size: 11, bold: true };
    titleCell.alignment = { horizontal: 'left', vertical: 'middle' };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF92D050' }
    };
    
    // Headers
    worksheet.getRow(2).height = 30;
    const headers = ['GL ACCOUNT', 'VENDOR', 'SUM OF AMOUNT IN LOC. CURR.'];
    
    worksheet.getRow(2).values = headers;
    worksheet.getRow(2).eachCell((cell: any) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF00B0F0' }
      };
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });
    
    // Column widths
    worksheet.columns = [
      { width: 15 },  // GL ACCOUNT
      { width: 40 },  // VENDOR
      { width: 25 }   // SUM OF AMOUNT
    ];
    
    let currentRow = 3;
    
    // Calculate summary data grouped by kdAkr (GL Account) and vendor
    const summaryData: Record<string, Record<string, number>> = {};
    
    Object.entries(groupedByKodeAkun).forEach(([kodeAkun, vendorGroups]) => {
      Object.entries(vendorGroups).forEach(([vendor, items]) => {
        items.forEach((item) => {
          const glAccount = item.kdAkr; // Using kode akun accrual
          const vendorName = item.vendor;
          
          // Saldo = saldo awal + total accrual - realisasi
          const totalAccrual = calculateAccrualAmount(item);
          const totalRealisasi = calculateItemRealisasi(item);
          const totalSaldo = calculateItemSaldo(item, totalAccrual, totalRealisasi);
          
          // Group by GL Account and Vendor
          if (!summaryData[glAccount]) {
            summaryData[glAccount] = {};
          }
          if (!summaryData[glAccount][vendorName]) {
            summaryData[glAccount][vendorName] = 0;
          }
          summaryData[glAccount][vendorName] += totalSaldo;
        });
      });
    });
    
    // Sort GL Accounts
    const sortedGLAccounts = Object.keys(summaryData).sort();
    
    let totalGrandTotal = 0;
    
    // Loop through sorted GL Accounts
    sortedGLAccounts.forEach((glAccount) => {
      const vendors = summaryData[glAccount];
      const sortedVendors = Object.keys(vendors).sort();
      
      sortedVendors.forEach((vendor, index) => {
        const amount = vendors[vendor];
        totalGrandTotal += amount;
        
        const row = worksheet.getRow(currentRow);
        
        // Only show GL Account on first vendor row
        if (index === 0) {
          row.getCell(1).value = parseFloat(glAccount);
          row.getCell(1).numFmt = '0';
        } else {
          row.getCell(1).value = '';
        }
        
        row.getCell(2).value = vendor;
        row.getCell(3).value = amount;
        row.getCell(3).numFmt = '#,##0.00';
        
        // Add borders
        for (let col = 1; col <= 3; col++) {
          const cell = row.getCell(col);
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
          
          if (col === 1) {
            cell.alignment = { horizontal: 'left', vertical: 'middle' };
          } else if (col === 2) {
            cell.alignment = { horizontal: 'left', vertical: 'middle' };
          } else {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
          }
        }
        
        currentRow++;
      });
    });
    
    // Add TOTAL row
    const totalRow = worksheet.getRow(currentRow);
    worksheet.mergeCells(currentRow, 1, currentRow, 2);
    const totalLabelCell = totalRow.getCell(1);
    totalLabelCell.value = 'TOTAL';
    totalLabelCell.font = { name: 'Calibri', size: 11, bold: true };
    totalLabelCell.alignment = { horizontal: 'center', vertical: 'middle' };
    totalLabelCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF00B0F0' }
    };
    totalLabelCell.font = { ...totalLabelCell.font, color: { argb: 'FFFFFFFF' } };
    
    const totalAmountCell = totalRow.getCell(3);
    totalAmountCell.value = totalGrandTotal;
    totalAmountCell.numFmt = '#,##0.00';
    totalAmountCell.font = { name: 'Calibri', size: 11, bold: true };
    totalAmountCell.alignment = { horizontal: 'right', vertical: 'middle' };
    totalAmountCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF00B0F0' }
    };
    totalAmountCell.font = { ...totalAmountCell.font, color: { argb: 'FFFFFFFF' } };
    
    for (let col = 1; col <= 3; col++) {
      const cell = totalRow.getCell(col);
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    }
    
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { 
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Rekap_Akrual_Global_${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error generating global report:', error);
      alert('Gagal membuat laporan global. Silakan coba lagi.');
    }
  };

  // Tampilkan dialog header/line text sebelum download jurnal realisasi
  const promptJurnalTexts = (callback: (headerText: string, lineText: string) => void) => {
    setJurnalPendingCallback(() => callback);
    setShowJurnalHeaderModal(true);
  };

  // Download Jurnal SAP per Kode Akun
  const handleDownloadJurnalSAPPerKodeAkun = async (kodeAkun: string, items: Accrual[], format: 'excel' | 'txt', companyCode: string, jenis: 'accrual' | 'realisasi', headerText = '', lineText = '') => {
    try {
      if (jenis === 'accrual') {
        // Download Jurnal Accrual untuk semua item dalam kode akun
        if (format === 'excel') {
          const { ExcelJS: ExcelJSLib } = await loadExcelLibraries();
          const workbook = new ExcelJSLib.Workbook();
          const worksheet = workbook.addWorksheet('Jurnal SAP Accrual');
          
          // Headers
          worksheet.getRow(1).height = 15;
          const headers1 = [
            'xblnr', 'bukrs', 'blart', 'bldat', 'budat', 'waers', 'kursf', 'bktxt', 
            'zuonr', 'hkont', 'wrbtr', 'sgtxt', 'prctr', 'kostl', '', 'nplnr', 'aufnr', 'valut', 'flag'
          ];
          
          const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFE699' } };
          
          worksheet.getRow(1).values = headers1;
          worksheet.getRow(1).eachCell((cell: any) => {
            cell.fill = headerFill;
            cell.font = { name: 'Calibri', size: 11, bold: true };
            cell.alignment = { horizontal: 'center', vertical: 'bottom' };
          });
          
          // Headers row 2
          worksheet.getRow(2).height = 15;
          const headers2 = [
            'Reference', 'company', 'doc type', 'doc date', 'posting date', 'currency', 'kurs', 
            'header text', 'Vendor/cu:', 'account', 'amount', 'line text', 'profit center', 
            'cost center', '', 'Network', 'order numi', 'value date', ''
          ];
          
          worksheet.getRow(2).values = headers2;
          worksheet.getRow(2).eachCell((cell: any) => {
            cell.fill = headerFill;
            cell.font = { name: 'Calibri', size: 11, bold: true };
            cell.alignment = { horizontal: 'center', vertical: 'bottom' };
          });
          
          // Column widths
          worksheet.columns = [
            { width: 12 }, { width: 10 }, { width: 9 }, { width: 9 }, { width: 12 }, 
            { width: 10 }, { width: 8 }, { width: 30 }, { width: 12 }, { width: 12 }, 
            { width: 15 }, { width: 30 }, { width: 12 }, { width: 12 }, { width: 3 }, 
            { width: 10 }, { width: 12 }, { width: 12 }, { width: 5 }
          ];
          
          let currentRow = 3;
          
          items.forEach((item) => {
            const totalAccrual = calculateAccrualAmount(item);
            if (totalAccrual > 0) {
              const todayAcc = new Date();
              const docDate = `${todayAcc.getFullYear()}${String(todayAcc.getMonth() + 1).padStart(2, '0')}${String(todayAcc.getDate()).padStart(2, '0')}`;
              const ht = item.headerText || '';
              
              // Kumpulkan rincian dari semua periode
              const allRincian = (item.periodes || []).flatMap(p => p.costcenters || []);
              
              if (allRincian.length > 0) {
                // Group by kdAkunBiaya+costCenter
                const grp = new Map<string, { kdAkunBiaya: string; costCenter: string; amount: number; headerText: string; lineText: string }>();
                for (const r of allRincian) {
                  const k = `${r.kdAkunBiaya || item.kdAkunBiaya}||${r.costCenter || ''}`;
                  const e = grp.get(k);
                  if (e) e.amount += Math.abs(r.amount); else grp.set(k, { kdAkunBiaya: r.kdAkunBiaya || item.kdAkunBiaya, costCenter: r.costCenter || '', amount: Math.abs(r.amount), headerText: r.headerText || ht, lineText: r.lineText || ht });
                }
                const total = Array.from(grp.values()).reduce((s, g) => s + g.amount, 0);
                // KREDIT - Kode Akun Accrual (sum)
                const rowAkr = worksheet.getRow(currentRow++);
                rowAkr.getCell(1).value = ''; rowAkr.getCell(2).value = companyCode; rowAkr.getCell(3).value = 'SA';
                rowAkr.getCell(4).value = docDate; rowAkr.getCell(5).value = docDate; rowAkr.getCell(6).value = 'IDR';
                rowAkr.getCell(7).value = ''; rowAkr.getCell(8).value = ht; rowAkr.getCell(9).value = '';
                rowAkr.getCell(10).value = item.kdAkr; rowAkr.getCell(11).value = -Math.round(total); rowAkr.getCell(11).numFmt = '0';
                rowAkr.getCell(12).value = ht; rowAkr.getCell(13).value = ''; rowAkr.getCell(14).value = '';
                rowAkr.getCell(15).value = ''; rowAkr.getCell(16).value = ''; rowAkr.getCell(17).value = '';
                rowAkr.getCell(18).value = ''; rowAkr.getCell(19).value = 'G';
                // DEBIT - per rincian
                for (const [, g] of grp) {
                  const rowBiaya = worksheet.getRow(currentRow++);
                  rowBiaya.getCell(1).value = ''; rowBiaya.getCell(2).value = companyCode; rowBiaya.getCell(3).value = 'SA';
                  rowBiaya.getCell(4).value = docDate; rowBiaya.getCell(5).value = docDate; rowBiaya.getCell(6).value = 'IDR';
                  rowBiaya.getCell(7).value = ''; rowBiaya.getCell(8).value = g.headerText; rowBiaya.getCell(9).value = '';
                  rowBiaya.getCell(10).value = g.kdAkunBiaya; rowBiaya.getCell(11).value = Math.round(g.amount); rowBiaya.getCell(11).numFmt = '0';
                  rowBiaya.getCell(12).value = g.lineText; rowBiaya.getCell(13).value = ''; rowBiaya.getCell(14).value = g.costCenter;
                  rowBiaya.getCell(15).value = ''; rowBiaya.getCell(16).value = ''; rowBiaya.getCell(17).value = '';
                  rowBiaya.getCell(18).value = ''; rowBiaya.getCell(19).value = 'G';
                }
              } else {
                // Fallback: 1 DEBIT + 1 KREDIT
                const row1 = worksheet.getRow(currentRow++);
                row1.getCell(1).value = ''; row1.getCell(2).value = companyCode; row1.getCell(3).value = 'SA';
                row1.getCell(4).value = docDate; row1.getCell(5).value = docDate; row1.getCell(6).value = 'IDR';
                row1.getCell(7).value = ''; row1.getCell(8).value = ht; row1.getCell(9).value = '';
                row1.getCell(10).value = item.kdAkunBiaya; row1.getCell(11).value = Math.round(totalAccrual); row1.getCell(11).numFmt = '0';
                row1.getCell(12).value = ht; row1.getCell(13).value = ''; row1.getCell(14).value = item.costCenter || '';
                row1.getCell(15).value = ''; row1.getCell(16).value = ''; row1.getCell(17).value = '';
                row1.getCell(18).value = ''; row1.getCell(19).value = 'G';
                const row2 = worksheet.getRow(currentRow++);
                row2.getCell(1).value = ''; row2.getCell(2).value = companyCode; row2.getCell(3).value = 'SA';
                row2.getCell(4).value = docDate; row2.getCell(5).value = docDate; row2.getCell(6).value = 'IDR';
                row2.getCell(7).value = ''; row2.getCell(8).value = ht; row2.getCell(9).value = '';
                row2.getCell(10).value = item.kdAkr; row2.getCell(11).value = -Math.round(totalAccrual); row2.getCell(11).numFmt = '0';
                row2.getCell(12).value = ht; row2.getCell(13).value = ''; row2.getCell(14).value = '';
                row2.getCell(15).value = ''; row2.getCell(16).value = ''; row2.getCell(17).value = '';
                row2.getCell(18).value = ''; row2.getCell(19).value = 'G';
              }
            }
          });
          
          const buffer = await workbook.xlsx.writeBuffer();
          const blob = new Blob([buffer], { 
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
          });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `Jurnal_SAP_Accrual_${companyCode}_${kodeAkun}_${new Date().toISOString().split('T')[0]}.xlsx`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        } else {
          // Format TXT
          const rows: string[][] = [];
          
          items.forEach((item) => {
            const totalAccrual = calculateAccrualAmount(item);
            if (totalAccrual > 0) {
              const todayAcc = new Date();
              const docDate = `${todayAcc.getFullYear()}${String(todayAcc.getMonth() + 1).padStart(2, '0')}${String(todayAcc.getDate()).padStart(2, '0')}`;
              const ht = item.headerText || '';
              
              // Kumpulkan rincian dari semua periode
              const allRincian = (item.periodes || []).flatMap(p => p.costcenters || []);
              
              if (allRincian.length > 0) {
                // Group by kdAkunBiaya+costCenter
                const grp = new Map<string, { kdAkunBiaya: string; costCenter: string; amount: number; headerText: string; lineText: string }>();
                for (const r of allRincian) {
                  const k = `${r.kdAkunBiaya || item.kdAkunBiaya}||${r.costCenter || ''}`;
                  const e = grp.get(k);
                  if (e) e.amount += Math.abs(r.amount); else grp.set(k, { kdAkunBiaya: r.kdAkunBiaya || item.kdAkunBiaya, costCenter: r.costCenter || '', amount: Math.abs(r.amount), headerText: r.headerText || ht, lineText: r.lineText || ht });
                }
                const total = Array.from(grp.values()).reduce((s, g) => s + g.amount, 0);
                // KREDIT - Kode Akun Accrual (sum)
                rows.push(['', companyCode, 'SA', docDate, docDate, 'IDR', '',
                  ht, '', item.kdAkr, (-Math.round(total)).toString(), ht, '', '', '', '', '', '', 'G']);
                // DEBIT - per rincian
                for (const [, g] of grp) {
                  rows.push(['', companyCode, 'SA', docDate, docDate, 'IDR', '',
                    g.headerText, '', g.kdAkunBiaya, Math.round(g.amount).toString(), g.lineText, '', g.costCenter, '', '', '', '', 'G']);
                }
              } else {
                // Fallback: 1 DEBIT + 1 KREDIT
                rows.push(['', companyCode, 'SA', docDate, docDate, 'IDR', '',
                  ht, '', item.kdAkunBiaya, Math.round(totalAccrual).toString(),
                  ht, '', item.costCenter || '', '', '', '', '', 'G']);
                rows.push(['', companyCode, 'SA', docDate, docDate, 'IDR', '',
                  ht, '', item.kdAkr, (-Math.round(totalAccrual)).toString(),
                  ht, '', '', '', '', '', '', 'G']);
              }
            }
          });
          
          const txtContent = rows.map(row => row.join('\t')).join('\n');
          const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `Jurnal_SAP_Accrual_${companyCode}_${kodeAkun}_${new Date().toISOString().split('T')[0]}.txt`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        }
      } else {
        // Download Jurnal Realisasi untuk semua item dalam kode akun
        const allRealisasi: { item: Accrual; realisasi: RealisasiData }[] = [];
        
        items.forEach((item) => {
          if (item.periodes) {
            item.periodes.forEach((periode) => {
              if (periode.realisasis && periode.realisasis.length > 0) {
                periode.realisasis.forEach((realisasi) => {
                  allRealisasi.push({ item, realisasi });
                });
              }
            });
          }
        });
        
        if (allRealisasi.length === 0) {
          alert('Tidak ada realisasi untuk kode akun ini.');
          return;
        }
        
        if (format === 'excel') {
          const { ExcelJS: ExcelJSLib } = await loadExcelLibraries();
          const workbook = new ExcelJSLib.Workbook();
          const worksheet = workbook.addWorksheet('Jurnal SAP Realisasi');
          
          // Headers
          worksheet.getRow(1).height = 15;
          const headers1 = [
            'xblnr', 'bukrs', 'blart', 'bldat', 'budat', 'waers', 'kursf', 'bktxt', 
            'zuonr', 'hkont', 'wrbtr', 'sgtxt', 'prctr', 'kostl', '', 'nplnr', 'aufnr', 'valut', 'flag'
          ];
          
          const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFE699' } };
          
          worksheet.getRow(1).values = headers1;
          worksheet.getRow(1).eachCell((cell: any) => {
            cell.fill = headerFill;
            cell.font = { name: 'Calibri', size: 11, bold: true };
            cell.alignment = { horizontal: 'center', vertical: 'bottom' };
          });
          
          // Headers row 2
          worksheet.getRow(2).height = 15;
          const headers2 = [
            'Reference', 'company', 'doc type', 'doc date', 'posting date', 'currency', 'kurs', 
            'header text', 'Vendor/cu:', 'account', 'amount', 'line text', 'profit center', 
            'cost center', '', 'Network', 'order numi', 'value date', ''
          ];
          
          worksheet.getRow(2).values = headers2;
          worksheet.getRow(2).eachCell((cell: any) => {
            cell.fill = headerFill;
            cell.font = { name: 'Calibri', size: 11, bold: true };
            cell.alignment = { horizontal: 'center', vertical: 'bottom' };
          });
          
          // Column widths
          worksheet.columns = [
            { width: 12 }, { width: 10 }, { width: 9 }, { width: 9 }, { width: 12 }, 
            { width: 10 }, { width: 8 }, { width: 30 }, { width: 12 }, { width: 12 }, 
            { width: 15 }, { width: 30 }, { width: 12 }, { width: 12 }, { width: 3 }, 
            { width: 10 }, { width: 12 }, { width: 12 }, { width: 5 }
          ];
          
          // Grup: kode akun accrual (sum) + kode akun biaya per kombinasi
          const akrGroupsE = new Map<string, number>();
          const biayaGroupsE = new Map<string, { kdAkunBiaya: string; costCenter: string; amount: number }>();
          let maxDateE = new Date(0);
          allRealisasi.forEach(({ item, realisasi }) => {
            const amt = Math.abs(realisasi.amount);
            akrGroupsE.set(item.kdAkr, (akrGroupsE.get(item.kdAkr) ?? 0) + amt);
            const kdBiaya = realisasi.kdAkunBiaya || item.kdAkunBiaya || '';
            const cc = realisasi.costCenter || item.costCenter || '';
            const bKey = `${kdBiaya}||${cc}`;
            const eb = biayaGroupsE.get(bKey);
            if (eb) eb.amount += amt; else biayaGroupsE.set(bKey, { kdAkunBiaya: kdBiaya, costCenter: cc, amount: amt });
            const d = new Date(realisasi.tanggalRealisasi);
            if (d > maxDateE) maxDateE = d;
          });
          const docDateR = `${maxDateE.getFullYear()}${String(maxDateE.getMonth() + 1).padStart(2, '0')}${String(maxDateE.getDate()).padStart(2, '0')}`;
          let currentRow = 3;
          const fillRow = (row: any, hkont: string, wrbtr: number, kostl: string) => {
            row.getCell(1).value = ''; row.getCell(2).value = companyCode; row.getCell(3).value = 'SA';
            row.getCell(4).value = docDateR; row.getCell(5).value = docDateR; row.getCell(6).value = 'IDR';
            row.getCell(7).value = ''; row.getCell(8).value = headerText; row.getCell(9).value = '';
            row.getCell(10).value = hkont; row.getCell(11).value = Math.round(Math.abs(wrbtr)) * (wrbtr < 0 ? -1 : 1);
            row.getCell(11).numFmt = '0';
            row.getCell(12).value = lineText; row.getCell(13).value = ''; row.getCell(14).value = kostl;
            row.getCell(15).value = ''; row.getCell(16).value = ''; row.getCell(17).value = '';
            row.getCell(18).value = ''; row.getCell(19).value = 'G';
          };
          // Kode akun accrual (KREDIT, positif) - satu baris per kdAkr
          for (const [kdAkr, total] of akrGroupsE) {
            fillRow(worksheet.getRow(currentRow++), kdAkr, Math.round(total), '');
          }
          // Kode akun biaya (DEBIT, negatif) - satu baris per kombinasi kdAkunBiaya+costCenter
          for (const [, g] of biayaGroupsE) {
            fillRow(worksheet.getRow(currentRow++), g.kdAkunBiaya, -Math.round(g.amount), g.costCenter);
          }
          
          const buffer = await workbook.xlsx.writeBuffer();
          const blob = new Blob([buffer], { 
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
          });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `Jurnal_SAP_Realisasi_${companyCode}_${kodeAkun}_${new Date().toISOString().split('T')[0]}.xlsx`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        } else {
          // Format TXT - grup kode akun accrual (sum) + kode akun biaya per kombinasi
          const akrGroupsT = new Map<string, number>();
          const biayaGroupsT = new Map<string, { kdAkunBiaya: string; costCenter: string; amount: number }>();
          let maxDateT = new Date(0);
          allRealisasi.forEach(({ item, realisasi }) => {
            const amt = Math.abs(realisasi.amount);
            akrGroupsT.set(item.kdAkr, (akrGroupsT.get(item.kdAkr) ?? 0) + amt);
            const kdBiaya = realisasi.kdAkunBiaya || item.kdAkunBiaya || '';
            const cc = realisasi.costCenter || item.costCenter || '';
            const bKey = `${kdBiaya}||${cc}`;
            const eb = biayaGroupsT.get(bKey);
            if (eb) eb.amount += amt; else biayaGroupsT.set(bKey, { kdAkunBiaya: kdBiaya, costCenter: cc, amount: amt });
            const d = new Date(realisasi.tanggalRealisasi);
            if (d > maxDateT) maxDateT = d;
          });
          const docDateRT = `${maxDateT.getFullYear()}${String(maxDateT.getMonth() + 1).padStart(2, '0')}${String(maxDateT.getDate()).padStart(2, '0')}`;
          const rows: string[][] = [];
          for (const [kdAkr, total] of akrGroupsT) {
            rows.push(['', companyCode, 'SA', docDateRT, docDateRT, 'IDR', '',
              headerText, '', kdAkr, Math.round(total).toString(), lineText, '', '', '', '', '', '', 'G']);
          }
          for (const [, g] of biayaGroupsT) {
            rows.push(['', companyCode, 'SA', docDateRT, docDateRT, 'IDR', '',
              headerText, '', g.kdAkunBiaya, (-Math.round(g.amount)).toString(), lineText, '', g.costCenter, '', '', '', '', 'G']);
          }
          
          const txtContent = rows.map(row => row.join('\t')).join('\n');
          const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `Jurnal_SAP_Realisasi_${companyCode}_${kodeAkun}_${new Date().toISOString().split('T')[0]}.txt`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        }
      }
    } catch (error) {
      console.error('Error generating jurnal SAP per kode akun:', error);
      alert('Gagal membuat jurnal SAP per kode akun. Silakan coba lagi.');
    }
  };

  // Download Jurnal SAP TXT per Periode
  const handleDownloadJurnalSAPPerPeriodeTxt = (item: Accrual, periode: AccrualPeriode, headerText = '', lineText = '') => {
    const companyCode = item.companyCode || '2000';
    
    if (!item.companyCode) {
      alert('Company code tidak ditemukan untuk item ini');
      return;
    }
    
    // Gunakan tanggal hari ini sebagai doc date dan posting date jurnal accrual
    const todayAcc = new Date();
    const docDate = `${todayAcc.getFullYear()}${String(todayAcc.getMonth() + 1).padStart(2, '0')}${String(todayAcc.getDate()).padStart(2, '0')}`;
    const ht = item.headerText || '';
    
    const rows: string[][] = [];
    const rincian = periode.costcenters || [];
    
    if (rincian.length > 0) {
      // Punya rincian: N baris debit (per rincian) + 1 baris kredit (sum kdAkr)
      const total = rincian.reduce((s, r) => s + Math.abs(r.amount), 0);
      // 1 baris KREDIT - Kode Akun Accrual (sum, negatif)
      rows.push(['', companyCode, 'SA', docDate, docDate, 'IDR', '',
        ht, '', item.kdAkr, (-Math.round(total)).toString(), ht, '', '', '', '', '', '', 'G']);
      // N baris DEBIT - per rincian
      for (const r of rincian) {
        rows.push(['', companyCode, 'SA', docDate, docDate, 'IDR', '',
          r.headerText || ht, '', r.kdAkunBiaya || item.kdAkunBiaya, Math.round(Math.abs(r.amount)).toString(),
          r.lineText || ht, '', r.costCenter || '', '', '', '', '', 'G']);
      }
    } else {
      // Fallback: 1 baris DEBIT + 1 baris KREDIT
      rows.push(['', companyCode, 'SA', docDate, docDate, 'IDR', '',
        ht, '', item.kdAkunBiaya, Math.round(Math.abs(periode.amountAccrual)).toString(),
        ht, '', item.costCenter || '', '', '', '', '', 'G']);
      rows.push(['', companyCode, 'SA', docDate, docDate, 'IDR', '',
        ht, '', item.kdAkr, (-Math.round(Math.abs(periode.amountAccrual))).toString(),
        ht, '', '', '', '', '', '', 'G']);
    }
    
    const txtContent = rows.map(row => row.join('\t')).join('\n');
    const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Jurnal_SAP_${companyCode}_${item.noPo || item.id}_${periode.bulan.replace(' ', '_')}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Download Jurnal SAP TXT per Realisasi
  const handleDownloadJurnalSAPPerRealisasiTxt = (realisasi: RealisasiData, item: Accrual) => {
    const companyCode = item.companyCode || '2000';
    
    // Parse tanggal realisasi
    const realisasiDate = new Date(realisasi.tanggalRealisasi);
    const docDate = `${realisasiDate.getFullYear()}${String(realisasiDate.getMonth() + 1).padStart(2, '0')}${String(realisasiDate.getDate()).padStart(2, '0')}`;
    
    // Build TXT content (tab-separated)
    const rows: string[][] = [];
    
    // Entry 1: DEBIT - Kode Akun Biaya (negative amount untuk realisasi)
    rows.push([
      '',
      companyCode,
      'SA',
      docDate,
      docDate,
      'IDR',
      '',
      realisasi.keterangan || `Realisasi ${realisasi.tanggalRealisasi}`,
      '',
      realisasi.kdAkunBiaya || item.kdAkunBiaya,
      (-Math.round(Math.abs(realisasi.amount))).toString(),
      realisasi.keterangan || `Realisasi ${realisasi.tanggalRealisasi}`,
      '',
      realisasi.costCenter || item.costCenter || '',
      '',
      '',
      '',
      '',
      'G'
    ]);
    
    // Entry 2: KREDIT - Kode Akun Accrual (positive amount sebagai balancing)
    rows.push([
      '',
      companyCode,
      'SA',
      docDate,
      docDate,
      'IDR',
      '',
      realisasi.keterangan || `Realisasi ${realisasi.tanggalRealisasi}`,
      '',
      item.kdAkr,
      Math.round(Math.abs(realisasi.amount)).toString(),
      realisasi.keterangan || `Realisasi ${realisasi.tanggalRealisasi}`,
      '',
      '', // Cost center kosong untuk akun accrual
      '',
      '',
      '',
      '',
      'G'
    ]);
    
    // Convert to TXT string (tab-separated)
    const txtContent = rows.map(row => row.join('\t')).join('\n');
    
    // Create blob and download
    const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Jurnal_SAP_Realisasi_${companyCode}_${realisasi.id}_${new Date(realisasi.tanggalRealisasi).toISOString().split('T')[0]}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Download Jurnal SAP per Periode
  const handleDownloadJurnalSAPPerPeriode = async (item: Accrual, periode: AccrualPeriode, headerText = '', lineText = '') => {
    try {
      const { ExcelJS: ExcelJSLib } = await loadExcelLibraries();
      const companyCode = item.companyCode || '2000';
      
      if (!item.companyCode) {
        alert('Company code tidak ditemukan untuk item ini');
        return;
      }
      
      const workbook = new ExcelJSLib.Workbook();
      const worksheet = workbook.addWorksheet('Jurnal SAP');
    
      // Headers
      worksheet.getRow(1).height = 15;
      const headers1 = [
        'xblnr', 'bukrs', 'blart', 'bldat', 'budat', 'waers', 'kursf', 'bktxt', 
        'zuonr', 'hkont', 'wrbtr', 'sgtxt', 'prctr', 'kostl', '', 'nplnr', 'aufnr', 'valut', 'flag'
      ];
      const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFE699' } };
      worksheet.getRow(1).values = headers1;
      worksheet.getRow(1).eachCell((cell: any) => {
        cell.fill = headerFill;
        cell.font = { name: 'Calibri', size: 11, bold: true };
        cell.alignment = { horizontal: 'center', vertical: 'bottom' };
      });
      worksheet.getRow(2).height = 15;
      const headers2 = [
        'Reference', 'company', 'doc type', 'doc date', 'posting date', 'currency', 'kurs', 
        'header text', 'Vendor/cu:', 'account', 'amount', 'line text', 'profit center', 
        'cost center', '', 'Network', 'order numi', 'value date', ''
      ];
      worksheet.getRow(2).values = headers2;
      worksheet.getRow(2).eachCell((cell: any) => {
        cell.fill = headerFill;
        cell.font = { name: 'Calibri', size: 11, bold: true };
        cell.alignment = { horizontal: 'center', vertical: 'bottom' };
      });
      worksheet.columns = [
        { width: 12 }, { width: 10 }, { width: 9 }, { width: 9 }, { width: 12 }, 
        { width: 10 }, { width: 8 }, { width: 30 }, { width: 12 }, { width: 12 }, 
        { width: 15 }, { width: 30 }, { width: 12 }, { width: 12 }, { width: 3 }, 
        { width: 10 }, { width: 12 }, { width: 12 }, { width: 5 }
      ];
      
      const todayAcc = new Date();
      const docDate = `${todayAcc.getFullYear()}${String(todayAcc.getMonth() + 1).padStart(2, '0')}${String(todayAcc.getDate()).padStart(2, '0')}`;
      const ht = item.headerText || '';
      let currentRow = 3;
      
      const writeRow = (hkont: string, wrbtr: number, kostl: string, bktxt = ht, sgtxt = ht) => {
        const row = worksheet.getRow(currentRow++);
        row.height = 15;
        row.getCell(1).value = ''; row.getCell(2).value = companyCode; row.getCell(3).value = 'SA';
        row.getCell(4).value = docDate; row.getCell(5).value = docDate; row.getCell(6).value = 'IDR';
        row.getCell(7).value = ''; row.getCell(8).value = bktxt; row.getCell(9).value = '';
        row.getCell(10).value = hkont;
        row.getCell(11).value = Math.round(Math.abs(wrbtr)) * (wrbtr < 0 ? -1 : 1);
        row.getCell(11).numFmt = '0';
        row.getCell(12).value = sgtxt; row.getCell(13).value = ''; row.getCell(14).value = kostl;
        row.getCell(15).value = ''; row.getCell(16).value = ''; row.getCell(17).value = '';
        row.getCell(18).value = ''; row.getCell(19).value = 'G';
      };
      
      const rincian = periode.costcenters || [];
      if (rincian.length > 0) {
        // Punya rincian: 1 baris KREDIT (kdAkr, sum negatif) + N baris DEBIT per rincian
        const total = rincian.reduce((s, r) => s + Math.abs(r.amount), 0);
        writeRow(item.kdAkr, -Math.round(total), '');
        for (const r of rincian) {
          writeRow(r.kdAkunBiaya || item.kdAkunBiaya, Math.round(Math.abs(r.amount)), r.costCenter || '', r.headerText || ht, r.lineText || ht);
        }
      } else {
        // Fallback: 1 baris DEBIT + 1 baris KREDIT
        writeRow(item.kdAkunBiaya, Math.round(Math.abs(periode.amountAccrual)), item.costCenter || '');
        writeRow(item.kdAkr, -Math.round(Math.abs(periode.amountAccrual)), '');
      }
      
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Jurnal_SAP_${companyCode}_${item.noPo || item.id}_${periode.bulan.replace(' ', '_')}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error generating jurnal SAP per periode:', error);
      alert('Gagal membuat jurnal SAP per periode. Silakan coba lagi.');
    }
  };

  // Download Jurnal SAP per Realisasi
  const handleDownloadJurnalSAPPerRealisasi = async (realisasi: RealisasiData, item: Accrual) => {
    try {
      const { ExcelJS: ExcelJSLib } = await loadExcelLibraries();
      const companyCode = item.companyCode || '2000';
      
      const workbook = new ExcelJSLib.Workbook();
      const worksheet = workbook.addWorksheet('Jurnal SAP');
    
      // Headers
      worksheet.getRow(1).height = 15;
      const headers1 = [
        'xblnr', 'bukrs', 'blart', 'bldat', 'budat', 'waers', 'kursf', 'bktxt', 
        'zuonr', 'hkont', 'wrbtr', 'sgtxt', 'prctr', 'kostl', '', 'nplnr', 'aufnr', 'valut', 'flag'
      ];
      
      const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFE699' } };
      
      worksheet.getRow(1).values = headers1;
      worksheet.getRow(1).eachCell((cell: any) => {
        cell.fill = headerFill;
        cell.font = { name: 'Calibri', size: 11, bold: true };
        cell.alignment = { horizontal: 'center', vertical: 'bottom' };
      });
      
      // Headers row 2
      worksheet.getRow(2).height = 15;
      const headers2 = [
        'Reference', 'company', 'doc type', 'doc date', 'posting date', 'currency', 'kurs', 
        'header text', 'Vendor/cu:', 'account', 'amount', 'line text', 'profit center', 
        'cost center', '', 'Network', 'order numi', 'value date', ''
      ];
      
      worksheet.getRow(2).values = headers2;
      worksheet.getRow(2).eachCell((cell: any) => {
        cell.fill = headerFill;
        cell.font = { name: 'Calibri', size: 11, bold: true };
        cell.alignment = { horizontal: 'center', vertical: 'bottom' };
      });
      
      // Column widths
      worksheet.columns = [
        { width: 12 }, { width: 10 }, { width: 9 }, { width: 9 }, { width: 12 }, 
        { width: 10 }, { width: 8 }, { width: 30 }, { width: 12 }, { width: 12 }, 
        { width: 15 }, { width: 30 }, { width: 12 }, { width: 12 }, { width: 3 }, 
        { width: 10 }, { width: 12 }, { width: 12 }, { width: 5 }
      ];
      
      // Parse tanggal realisasi
      const realisasiDate = new Date(realisasi.tanggalRealisasi);
      const docDate = `${realisasiDate.getFullYear()}${String(realisasiDate.getMonth() + 1).padStart(2, '0')}${String(realisasiDate.getDate()).padStart(2, '0')}`;
      
      // Entry 1: DEBIT - Kode Akun Biaya (dari realisasi)
      const row1 = worksheet.getRow(3);
      row1.height = 15;
      
      row1.getCell(1).value = ''; // xblnr
      row1.getCell(2).value = companyCode; // bukrs
      row1.getCell(3).value = 'SA'; // blart
      row1.getCell(4).value = docDate; // bldat
      row1.getCell(5).value = docDate; // budat
      row1.getCell(6).value = 'IDR'; // waers
      row1.getCell(7).value = ''; // kursf
      row1.getCell(8).value = realisasi.keterangan || `Realisasi ${realisasi.tanggalRealisasi}`; // bktxt
      row1.getCell(9).value = ''; // zuonr
      row1.getCell(10).value = realisasi.kdAkunBiaya || item.kdAkunBiaya; // hkont
      row1.getCell(11).value = -Math.round(Math.abs(realisasi.amount)); // wrbtr - NEGATIF untuk kode akun biaya
      row1.getCell(11).numFmt = '0';
      row1.getCell(12).value = realisasi.keterangan || `Realisasi ${realisasi.tanggalRealisasi}`; // sgtxt
      row1.getCell(13).value = ''; // prctr
      row1.getCell(14).value = realisasi.costCenter || item.costCenter || ''; // kostl
      row1.getCell(15).value = ''; // empty
      row1.getCell(16).value = ''; // nplnr
      row1.getCell(17).value = ''; // aufnr
      row1.getCell(18).value = ''; // valut
      row1.getCell(19).value = 'G'; // flag
      
      // Entry 2: CREDIT - Kode Akun Accrual
      const row2 = worksheet.getRow(4);
      row2.height = 15;
      
      row2.getCell(1).value = ''; // xblnr
      row2.getCell(2).value = companyCode; // bukrs
      row2.getCell(3).value = 'SA'; // blart
      row2.getCell(4).value = docDate; // bldat
      row2.getCell(5).value = docDate; // budat
      row2.getCell(6).value = 'IDR'; // waers
      row2.getCell(7).value = ''; // kursf
      row2.getCell(8).value = realisasi.keterangan || `Realisasi ${realisasi.tanggalRealisasi}`; // bktxt
      row2.getCell(9).value = ''; // zuonr
      row2.getCell(10).value = item.kdAkr; // hkont
      row2.getCell(11).value = Math.round(Math.abs(realisasi.amount)); // wrbtr - POSITIF untuk kode akun accrual
      row2.getCell(11).numFmt = '0';
      row2.getCell(12).value = realisasi.keterangan || `Realisasi ${realisasi.tanggalRealisasi}`; // sgtxt
      row2.getCell(13).value = ''; // prctr
      row2.getCell(14).value = ''; // kostl
      row2.getCell(15).value = ''; // empty
      row2.getCell(16).value = ''; // nplnr
      row2.getCell(17).value = ''; // aufnr
      row2.getCell(18).value = ''; // valut
      row2.getCell(19).value = 'G'; // flag
      
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { 
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Jurnal_SAP_Realisasi_${companyCode}_${realisasi.id}_${new Date(realisasi.tanggalRealisasi).toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error generating jurnal SAP per realisasi:', error);
      alert('Gagal membuat jurnal SAP per realisasi. Silakan coba lagi.');
    }
  };

  // Download Jurnal SAP Excel untuk Group Cost Element (semua realisasi dalam group)
  const handleDownloadJurnalSAPPerCostElementGroup = async (realisasiItems: RealisasiData[], item: Accrual, costElement: string, headerText = '', lineText = '') => {
    try {
      const { ExcelJS: ExcelJSLib } = await loadExcelLibraries();
      const companyCode = item.companyCode || '2000';
      
      const workbook = new ExcelJSLib.Workbook();
      const worksheet = workbook.addWorksheet('Jurnal SAP');
    
      // Headers
      worksheet.getRow(1).height = 15;
      const headers1 = [
        'xblnr', 'bukrs', 'blart', 'bldat', 'budat', 'waers', 'kursf', 'bktxt', 
        'zuonr', 'hkont', 'wrbtr', 'sgtxt', 'prctr', 'kostl', '', 'nplnr', 'aufnr', 'valut', 'flag'
      ];
      
      const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFE699' } };
      
      worksheet.getRow(1).values = headers1;
      worksheet.getRow(1).eachCell((cell: any) => {
        cell.fill = headerFill;
        cell.font = { name: 'Calibri', size: 11, bold: true };
        cell.alignment = { horizontal: 'center', vertical: 'bottom' };
      });
      
      // Headers row 2
      worksheet.getRow(2).height = 15;
      const headers2 = [
        'Reference', 'company', 'doc type', 'doc date', 'posting date', 'currency', 'kurs', 
        'header text', 'Vendor/cu:', 'account', 'amount', 'line text', 'profit center', 
        'cost center', '', 'Network', 'order numi', 'value date', ''
      ];
      
      worksheet.getRow(2).values = headers2;
      worksheet.getRow(2).eachCell((cell: any) => {
        cell.fill = headerFill;
        cell.font = { name: 'Calibri', size: 11, bold: true };
        cell.alignment = { horizontal: 'center', vertical: 'bottom' };
      });
      
      // Column widths
      worksheet.columns = [
        { width: 12 }, { width: 10 }, { width: 9 }, { width: 9 }, { width: 12 }, 
        { width: 10 }, { width: 8 }, { width: 30 }, { width: 12 }, { width: 12 }, 
        { width: 15 }, { width: 30 }, { width: 12 }, { width: 12 }, { width: 3 }, 
        { width: 10 }, { width: 12 }, { width: 12 }, { width: 5 }
      ];
      
      let currentRow = 3;
      
      // Grup: 1 baris kode akun accrual (sum) + N baris kode akun biaya per kombinasi
      const akrTotal = realisasiItems.reduce((s, r) => s + Math.abs(r.amount), 0);
      const biayaGrp = new Map<string, { kdAkunBiaya: string; costCenter: string; amount: number }>();
      let maxDateCE = new Date(0);
      for (const realisasi of realisasiItems) {
        const kdBiaya = realisasi.kdAkunBiaya || item.kdAkunBiaya || '';
        const cc = realisasi.costCenter || item.costCenter || '';
        const bKey = `${kdBiaya}||${cc}`;
        const eb = biayaGrp.get(bKey);
        const amt = Math.abs(realisasi.amount);
        if (eb) eb.amount += amt; else biayaGrp.set(bKey, { kdAkunBiaya: kdBiaya, costCenter: cc, amount: amt });
        const d = new Date(realisasi.tanggalRealisasi);
        if (d > maxDateCE) maxDateCE = d;
      }
      const docDateCE = `${maxDateCE.getFullYear()}${String(maxDateCE.getMonth() + 1).padStart(2, '0')}${String(maxDateCE.getDate()).padStart(2, '0')}`;
      const writeRowCE = (row: any, hkont: string, wrbtr: number, kostl: string) => {
        row.height = 15;
        row.getCell(1).value = ''; row.getCell(2).value = companyCode; row.getCell(3).value = 'SA';
        row.getCell(4).value = docDateCE; row.getCell(5).value = docDateCE; row.getCell(6).value = 'IDR';
        row.getCell(7).value = ''; row.getCell(8).value = headerText; row.getCell(9).value = '';
        row.getCell(10).value = hkont;
        row.getCell(11).value = Math.round(Math.abs(wrbtr)) * (wrbtr < 0 ? -1 : 1);
        row.getCell(11).numFmt = '0';
        row.getCell(12).value = lineText; row.getCell(13).value = ''; row.getCell(14).value = kostl;
        row.getCell(15).value = ''; row.getCell(16).value = ''; row.getCell(17).value = '';
        row.getCell(18).value = ''; row.getCell(19).value = 'G';
      };
      // Kode akun accrual - satu baris (KREDIT, positif)
      writeRowCE(worksheet.getRow(currentRow++), item.kdAkr, Math.round(akrTotal), '');
      // Kode akun biaya - satu baris per kombinasi (DEBIT, negatif)
      for (const [, g] of biayaGrp) {
        writeRowCE(worksheet.getRow(currentRow++), g.kdAkunBiaya, -Math.round(g.amount), g.costCenter);
      }
      
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { 
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Jurnal_SAP_CostElement_${costElement}_${companyCode}_${realisasiItems.length}items.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error generating grouped jurnal SAP:', error);
      alert('Gagal membuat jurnal SAP untuk group. Silakan coba lagi.');
    }
  };

  // Download Jurnal SAP TXT untuk Group Cost Element (semua realisasi dalam group)
  const handleDownloadJurnalSAPPerCostElementGroupTxt = (realisasiItems: RealisasiData[], item: Accrual, costElement: string, headerText = '', lineText = '') => {
    const companyCode = item.companyCode || '2000';
    
    // Grup: 1 baris kode akun accrual (sum) + N baris kode akun biaya per kombinasi
    const akrTotalTxt = realisasiItems.reduce((s, r) => s + Math.abs(r.amount), 0);
    const biayaGrpTxt = new Map<string, { kdAkunBiaya: string; costCenter: string; amount: number }>();
    let maxDateCETxt = new Date(0);
    for (const realisasi of realisasiItems) {
      const kdBiaya = realisasi.kdAkunBiaya || item.kdAkunBiaya || '';
      const cc = realisasi.costCenter || item.costCenter || '';
      const bKey = `${kdBiaya}||${cc}`;
      const eb = biayaGrpTxt.get(bKey);
      const amt = Math.abs(realisasi.amount);
      if (eb) eb.amount += amt; else biayaGrpTxt.set(bKey, { kdAkunBiaya: kdBiaya, costCenter: cc, amount: amt });
      const d = new Date(realisasi.tanggalRealisasi);
      if (d > maxDateCETxt) maxDateCETxt = d;
    }
    const docDateCETxt = `${maxDateCETxt.getFullYear()}${String(maxDateCETxt.getMonth() + 1).padStart(2, '0')}${String(maxDateCETxt.getDate()).padStart(2, '0')}`;
    const rows: string[][] = [];
    // Kode akun accrual - satu baris (KREDIT, positif)
    rows.push(['', companyCode, 'SA', docDateCETxt, docDateCETxt, 'IDR', '',
      headerText, '', item.kdAkr, Math.round(akrTotalTxt).toString(), lineText, '', '', '', '', '', '', 'G']);
    // Kode akun biaya - satu baris per kombinasi (DEBIT, negatif)
    for (const [, g] of biayaGrpTxt) {
      rows.push(['', companyCode, 'SA', docDateCETxt, docDateCETxt, 'IDR', '',
        headerText, '', g.kdAkunBiaya, (-Math.round(g.amount)).toString(), lineText, '', g.costCenter, '', '', '', '', 'G']);
    }
    
    // Convert to TXT string (tab-separated)
    const txtContent = rows.map(row => row.join('\t')).join('\n');
    
    // Create blob and download
    const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Jurnal_SAP_CostElement_${costElement}_${companyCode}_${realisasiItems.length}items.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Download Jurnal SAP Excel untuk Group Rincian Accrual (per kdAkunBiaya)
  const handleDownloadJurnalSAPPerRincianGroup = async (entries: CostCenterEntry[], item: Accrual, kdAkunBiaya: string, headerText = '', lineText = '') => {
    try {
      const { ExcelJS: ExcelJSLib } = await loadExcelLibraries();
      const companyCode = item.companyCode || '2000';
      const workbook = new ExcelJSLib.Workbook();
      const worksheet = workbook.addWorksheet('Jurnal SAP');
      const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFE699' } };
      const headers1 = ['xblnr','bukrs','blart','bldat','budat','waers','kursf','bktxt','zuonr','hkont','wrbtr','sgtxt','prctr','kostl','','nplnr','aufnr','valut','flag'];
      const headers2 = ['Reference','company','doc type','doc date','posting date','currency','kurs','header text','Vendor/cu:','account','amount','line text','profit center','cost center','','Network','order numi','value date',''];
      worksheet.getRow(1).height = 15; worksheet.getRow(1).values = headers1;
      worksheet.getRow(1).eachCell((cell: any) => { cell.fill = headerFill; cell.font = { name: 'Calibri', size: 11, bold: true }; cell.alignment = { horizontal: 'center', vertical: 'bottom' }; });
      worksheet.getRow(2).height = 15; worksheet.getRow(2).values = headers2;
      worksheet.getRow(2).eachCell((cell: any) => { cell.fill = headerFill; cell.font = { name: 'Calibri', size: 11, bold: true }; cell.alignment = { horizontal: 'center', vertical: 'bottom' }; });
      worksheet.columns = [{width:12},{width:10},{width:9},{width:9},{width:12},{width:10},{width:8},{width:30},{width:12},{width:12},{width:15},{width:30},{width:12},{width:12},{width:3},{width:10},{width:12},{width:12},{width:5}];
      const today = new Date();
      const docDate = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
      const total = entries.reduce((s,e) => s + Math.abs(e.amount), 0);
      let currentRow = 3;
      const writeRow = (hkont: string, wrbtr: number, kostl: string, bktxt: string, sgtxt: string) => {
        const row = worksheet.getRow(currentRow++);
        row.height = 15;
        row.getCell(1).value=''; row.getCell(2).value=companyCode; row.getCell(3).value='SA';
        row.getCell(4).value=docDate; row.getCell(5).value=docDate; row.getCell(6).value='IDR';
        row.getCell(7).value=''; row.getCell(8).value=bktxt; row.getCell(9).value='';
        row.getCell(10).value=hkont;
        row.getCell(11).value=Math.round(Math.abs(wrbtr))*(wrbtr<0?-1:1);
        row.getCell(11).numFmt='0';
        row.getCell(12).value=sgtxt; row.getCell(13).value=''; row.getCell(14).value=kostl;
        row.getCell(15).value=''; row.getCell(16).value=''; row.getCell(17).value='';
        row.getCell(18).value=''; row.getCell(19).value='G';
      };
      // 1 baris KREDIT: kdAkr, -total
      writeRow(item.kdAkr, -Math.round(total), '', headerText, lineText);
      // N baris DEBIT: per entry
      for (const e of entries) {
        writeRow(e.kdAkunBiaya || item.kdAkunBiaya, Math.round(Math.abs(e.amount)), e.costCenter || item.costCenter || '', e.headerText || headerText, e.lineText || lineText);
      }
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Jurnal_SAP_Accrual_${kdAkunBiaya}_${companyCode}_${entries.length}entri.xlsx`;
      document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error generating jurnal rincian accrual group:', error);
      alert('Gagal membuat jurnal SAP. Silakan coba lagi.');
    }
  };

  // Download Jurnal SAP TXT untuk Group Rincian Accrual (per kdAkunBiaya)
  const handleDownloadJurnalSAPPerRincianGroupTxt = (entries: CostCenterEntry[], item: Accrual, kdAkunBiaya: string, headerText = '', lineText = '') => {
    const companyCode = item.companyCode || '2000';
    const today = new Date();
    const docDate = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
    const total = entries.reduce((s,e) => s + Math.abs(e.amount), 0);
    const rows: string[][] = [];
    // 1 baris KREDIT: kdAkr, -total
    rows.push(['', companyCode, 'SA', docDate, docDate, 'IDR', '', headerText, '', item.kdAkr, (-Math.round(total)).toString(), lineText, '', '', '', '', '', '', 'G']);
    // N baris DEBIT: per entry
    for (const e of entries) {
      rows.push(['', companyCode, 'SA', docDate, docDate, 'IDR', '', e.headerText || headerText, '', e.kdAkunBiaya || item.kdAkunBiaya, Math.round(Math.abs(e.amount)).toString(), e.lineText || lineText, '', e.costCenter || item.costCenter || '', '', '', '', '', 'G']);
    }
    const txtContent = rows.map(row => row.join('\t')).join('\n');
    const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Jurnal_SAP_Accrual_${kdAkunBiaya}_${companyCode}_${entries.length}entri.txt`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
  };

  
  const handleDownloadJurnalSAPTxt = (item: Accrual, headerText = '', lineText = '') => {
    // Use company code from item
    const companyCode = item.companyCode || '2000';
    
    if (!item.companyCode) {
      alert('Company code tidak ditemukan untuk item ini');
      return;
    }
    
    // Build TXT content (tab-separated)
    const rows: string[][] = [];
    
    // Calculate total accrual for this specific item
    const totalAccrual = item.periodes?.reduce((sum, p) => {
      if (item.pembagianType === 'manual') {
        return sum + p.amountAccrual;
      }
      
      // Untuk otomatis, cek tanggal periode saja
      // Parse bulan periode (format: "Jan 2026")
      const [bulanName, tahunStr] = p.bulan.split(' ');
      const bulanMap: Record<string, number> = {
        'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'Mei': 4, 'Jun': 5,
        'Jul': 6, 'Agu': 7, 'Sep': 8, 'Okt': 9, 'Nov': 10, 'Des': 11
      };
      const periodeBulan = bulanMap[bulanName];
      const periodeTahun = parseInt(tahunStr);
      
      // Tanggal 1 bulan periode tersebut
      const today = new Date();
      const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const periodeDateOnly = new Date(periodeTahun, periodeBulan, 1);
      
      // Akui accrual jika sudah jatuh tempo ATAU jika sudah ada realisasi
      const totalRealisasi = p.totalRealisasi ?? 0;
      const hasRealisasi = totalRealisasi > 0;
      if (todayDate >= periodeDateOnly || hasRealisasi) {
        return sum + Math.abs(p.amountAccrual);
      }
      return sum;
    }, 0) || 0;
    
    const absTotalAccrual = totalAccrual;
    if (absTotalAccrual > 0) {
      const todayDoc = new Date();
      const docDate = `${todayDoc.getFullYear()}${String(todayDoc.getMonth() + 1).padStart(2, '0')}${String(todayDoc.getDate()).padStart(2, '0')}`;
      const year = todayDoc.getFullYear();
      
      // Entry 1: DEBIT - Kode Akun Biaya (positive amount)
      rows.push([
        '',
        companyCode,
        'SA',
        docDate,
        docDate,
        'IDR',
        '',
        headerText,
        '',
        item.kdAkunBiaya,
        Math.round(absTotalAccrual).toString(),
        lineText,
        '',
        item.costCenter || '',
        '',
        '',
        '',
        '',
        'G'
      ]);
      
      // Entry 2: KREDIT - Kode Akun Accrual (negative amount)
      rows.push([
        '',
        companyCode,
        'SA',
        docDate,
        docDate,
        'IDR',
        '',
        headerText,
        '',
        item.kdAkr,
        (-Math.round(absTotalAccrual)).toString(),
        lineText,
        '',
        '', // Cost center kosong untuk akun accrual
        '',
        '',
        '',
        '',
        'G'
      ]);
      
      // Convert to TXT string (tab-separated)
      const txtContent = rows.map(row => row.join('\t')).join('\n');
      
      // Create blob and download
      const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Jurnal_SAP_${companyCode}_${item.noPo || item.id}_${year}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  };

  // Jurnal SAP untuk Realisasi: template sama, kode akun biaya di bawah kode akun accrual (row1 = accrual, row2 = biaya)
  const handleDownloadJurnalSAPRealisasiPerItem = async (item: Accrual, headerText = '', lineText = '') => {
    try {
      const { ExcelJS: ExcelJSLib } = await loadExcelLibraries();
      const companyCode = item.companyCode || '2000';
      if (!item.companyCode) {
        alert('Company code tidak ditemukan untuk item ini');
        return;
      }
      const totalRealisasi = calculateItemRealisasi(item);
      if (totalRealisasi <= 0) {
        alert('Tidak ada realisasi untuk item ini.');
        return;
      }
      const workbook = new ExcelJSLib.Workbook();
      const worksheet = workbook.addWorksheet('Jurnal SAP Realisasi');
      worksheet.getRow(1).height = 15;
      const headers1 = [
        'xblnr', 'bukrs', 'blart', 'bldat', 'budat', 'waers', 'kursf', 'bktxt',
        'zuonr', 'hkont', 'wrbtr', 'sgtxt', 'prctr', 'kostl', '', 'nplnr', 'aufnr', 'valut', 'flag'
      ];
      const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFE699' } };
      worksheet.getRow(1).values = headers1;
      worksheet.getRow(1).eachCell((cell: any) => {
        cell.fill = headerFill;
        cell.font = { name: 'Calibri', size: 11, bold: true };
        cell.alignment = { horizontal: 'center', vertical: 'bottom' };
      });
      worksheet.getRow(2).height = 15;
      const headers2 = [
        'Reference', 'company', 'doc type', 'doc date', 'posting date', 'currency', 'kurs',
        'header text', 'Vendor/cu:', 'account', 'amount', 'line text', 'profit center',
        'cost center', '', 'Network', 'order numi', 'value date', ''
      ];
      worksheet.getRow(2).values = headers2;
      worksheet.getRow(2).eachCell((cell: any) => {
        cell.fill = headerFill;
        cell.font = { name: 'Calibri', size: 11, bold: true };
        cell.alignment = { horizontal: 'center', vertical: 'bottom' };
      });
      worksheet.columns = [
        { width: 12 }, { width: 10 }, { width: 9 }, { width: 9 }, { width: 12 }, { width: 10 }, { width: 8 },
        { width: 30 }, { width: 12 }, { width: 12 }, { width: 15 }, { width: 30 }, { width: 12 }, { width: 12 },
        { width: 3 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 5 }
      ];
      const startDate = new Date(item.startDate);
      const docDate = `${startDate.getFullYear()}${String(startDate.getMonth() + 1).padStart(2, '0')}${String(startDate.getDate()).padStart(2, '0')}`;
      const year = startDate.getFullYear();
      const amountRounded = Math.round(totalRealisasi);

      // Entry 1: KREDIT - Kode Akun Accrual (di atas), amount negatif
      const row1 = worksheet.getRow(3);
      row1.height = 15;
      row1.getCell(1).value = '';
      row1.getCell(2).value = companyCode;
      row1.getCell(3).value = 'SA';
      row1.getCell(4).value = docDate;
      row1.getCell(5).value = docDate;
      row1.getCell(6).value = 'IDR';
      row1.getCell(7).value = '';
      row1.getCell(8).value = headerText;
      row1.getCell(9).value = '';
      row1.getCell(10).value = item.kdAkr; // hkont = kode akun accrual
      row1.getCell(11).value = -amountRounded;
      row1.getCell(11).numFmt = '0';
      row1.getCell(12).value = lineText;
      row1.getCell(13).value = '';
      row1.getCell(14).value = ''; // kostl kosong untuk akun accrual
      row1.getCell(15).value = '';
      row1.getCell(16).value = '';
      row1.getCell(17).value = '';
      row1.getCell(18).value = '';
      row1.getCell(19).value = 'G';
      for (let col = 1; col <= 19; col++) {
        const cell = row1.getCell(col);
        cell.font = { name: 'Aptos Narrow', size: 12 };
        cell.alignment = { horizontal: col === 11 ? 'right' : 'left', vertical: 'bottom' };
      }

      // Entry 2: DEBIT - Kode Akun Biaya (di bawah), amount positif
      const row2 = worksheet.getRow(4);
      row2.height = 15;
      row2.getCell(1).value = '';
      row2.getCell(2).value = companyCode;
      row2.getCell(3).value = 'SA';
      row2.getCell(4).value = docDate;
      row2.getCell(5).value = docDate;
      row2.getCell(6).value = 'IDR';
      row2.getCell(7).value = '';
      row2.getCell(8).value = headerText;
      row2.getCell(9).value = '';
      row2.getCell(10).value = item.kdAkunBiaya; // hkont = kode akun biaya
      row2.getCell(11).value = -amountRounded; // wrbtr - NEGATIF untuk kode akun biaya
      row2.getCell(11).numFmt = '0';
      row2.getCell(12).value = lineText;
      row2.getCell(13).value = '';
      row2.getCell(14).value = item.costCenter || '';
      row2.getCell(15).value = '';
      row2.getCell(16).value = '';
      row2.getCell(17).value = '';
      row2.getCell(18).value = '';
      row2.getCell(19).value = 'G';
      for (let col = 1; col <= 19; col++) {
        const cell = row2.getCell(col);
        cell.font = { name: 'Aptos Narrow', size: 12 };
        cell.alignment = { horizontal: col === 11 ? 'right' : 'left', vertical: 'bottom' };
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Jurnal_SAP_Realisasi_${companyCode}_${item.noPo || item.id}_${year}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error generating Jurnal SAP Realisasi:', error);
      alert('Gagal membuat jurnal SAP realisasi. Silakan coba lagi.');
    }
  };

  // Download Jurnal Detail per Cost Center (grouped by Kode Akun)
  const handleDownloadJurnalDetail = async (kodeAkun?: string, periode?: string) => {
    try {
      // Build query parameters
      const params = new URLSearchParams();
      params.append('detail', 'true');
      params.append('format', 'txt');
      
      if (periode) {
        params.append('periode', periode);
      }
      
      // Note: Backend akan auto-group by kode akun, tidak perlu filter by kodeAkun disini
      // Karena kita ingin lihat semua breakdown

      const response = await fetch(`/api/accrual/jurnal/download?${params.toString()}`);
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to download jurnal');
      }

      // Download file
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      const timestamp = new Date().toISOString().split('T')[0];
      link.download = `jurnal_detail_${kodeAkun || 'all'}_${timestamp}.txt`;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading jurnal detail:', error);
      alert('Gagal download jurnal detail. Silakan coba lagi.');
    }
  };

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    
    // If kode akun changes, reset klasifikasi
    if (name === 'kdAkr') {
      setFormData(prev => ({ ...prev, [name]: value, klasifikasi: '' }));
    } else if (name === 'jumlahPeriode') {
      // Tambah/kurangi slot periode; manual = isi sendiri per periode, tidak dibagi dari Amount
      const newCount = parseInt(value) || 0;
      setFormData(prev => {
        const prevAmounts = prev.periodeAmounts || [];
        let newPeriodeAmounts: string[];
        if (newCount > prevAmounts.length) {
          newPeriodeAmounts = [...prevAmounts, ...Array(newCount - prevAmounts.length).fill('')];
        } else if (newCount < prevAmounts.length) {
          newPeriodeAmounts = prevAmounts.slice(0, newCount);
        } else {
          newPeriodeAmounts = prevAmounts.length ? [...prevAmounts] : Array(newCount).fill('');
        }
        return { ...prev, [name]: value, periodeAmounts: newPeriodeAmounts };
      });
    } else if (name === 'pembagianType') {
      // Initialize periodeAmounts for manual mode
      if (value === 'manual') {
        const count = parseInt(formData.jumlahPeriode) || 12;
        const newPeriodeAmounts = Array(count).fill('');
        setFormData(prev => ({ ...prev, [name]: value, periodeAmounts: newPeriodeAmounts }));
      } else {
        setFormData(prev => ({ ...prev, [name]: value, periodeAmounts: [] }));
      }
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  }, [formData.jumlahPeriode]);

  const handlePeriodeAmountChange = (index: number, value: string) => {
    setFormData(prev => {
      const newAmounts = [...prev.periodeAmounts];
      newAmounts[index] = value;
      const newSum = newAmounts.reduce((s, a) => s + (parseFloat(a) || 0), 0);
      return { ...prev, periodeAmounts: newAmounts, totalAmount: newSum.toFixed(2) };
    });
  };

  const handleEdit = useCallback((item: Accrual) => {
    setEditingId(item.id);
    
    // Get periodeAmounts if manual type (amountAccrual di DB negatif, tampilkan positif)
    const periodeAmounts = item.pembagianType === 'manual' && item.periodes 
      ? item.periodes.map(p => Math.abs(p.amountAccrual).toString())
      : [];
    
    setFormData({
      companyCode: item.companyCode || '',
      noPo: item.noPo || '',
      assignment: item.alokasi || '',
      kdAkr: item.kdAkr,
      kdAkunBiaya: item.kdAkunBiaya,
      vendor: item.vendor,
      deskripsi: item.deskripsi,
      headerText: item.headerText || '',
      klasifikasi: item.klasifikasi || '',
      totalAmount: Math.abs(item.totalAmount).toString(),
      saldoAwal: item.saldoAwal != null ? String(item.saldoAwal) : '',
      costCenter: item.costCenter || '',
      startDate: item.startDate.split('T')[0],
      jumlahPeriode: item.jumlahPeriode.toString(),
      pembagianType: item.pembagianType,
      periodeAmounts: periodeAmounts,
    });
    setShowModal(true);
  }, []);

  const handleDelete = useCallback(async (id: number) => {
    if (!confirm('Apakah Anda yakin ingin menghapus data ini?')) return;

    try {
      const response = await fetch(`/api/accrual?id=${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete accrual');

      fetchAccrualData();
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      alert('Data berhasil dihapus!');
    } catch (error) {
      console.error('Error deleting accrual:', error);
      alert('Gagal menghapus data');
    }
  }, []);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Yakin hapus ${selectedIds.size} data accrual terpilih?`)) return;

    setDeletingSelected(true);
    try {
      const ids = Array.from(selectedIds).join(',');
      const response = await fetch(`/api/accrual?ids=${ids}`, { method: 'DELETE' });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Gagal menghapus');
      }
      const data = await response.json();
      setSelectedIds(new Set());
      fetchAccrualData();
      alert(data.count != null ? `${data.count} data berhasil dihapus.` : 'Data berhasil dihapus.');
    } catch (error) {
      console.error('Error bulk delete:', error);
      alert('Gagal menghapus data terpilih');
    } finally {
      setDeletingSelected(false);
    }
  }, [selectedIds]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const isEditing = editingId !== null;
      const url = isEditing ? `/api/accrual?id=${editingId}` : '/api/accrual';
      const method = isEditing ? 'PUT' : 'POST';
      // Manual: tambah = user isi Amount saja, periode 0; edit = kirim nilai periode yang sudah ada
      const totalAmountToSend = parseFloat(formData.totalAmount) || 0;
      const saldoAwalToSend = formData.saldoAwal.trim() !== '' ? parseFloat(formData.saldoAwal) : null;
      const periodeCount = Math.max(1, parseInt(formData.jumlahPeriode) || 12);
      const periodeAmountsToSend = formData.pembagianType === 'manual'
        ? (isEditing && formData.periodeAmounts?.length ? formData.periodeAmounts : Array(periodeCount).fill('0'))
        : null;
      const startDateToSend = formData.startDate || new Date().toISOString().split('T')[0];

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          companyCode: formData.companyCode || null,
          noPo: formData.noPo || null,
          kdAkr: formData.kdAkr || '-',
          alokasi: formData.assignment || null,
          kdAkunBiaya: formData.kdAkunBiaya || '-',
          vendor: formData.vendor || '-',
          deskripsi: formData.deskripsi || '-',
          headerText: formData.headerText || null,
          klasifikasi: formData.klasifikasi || null,
          totalAmount: totalAmountToSend,
          saldoAwal: saldoAwalToSend,
          costCenter: formData.costCenter || null,
          startDate: startDateToSend,
          jumlahPeriode: periodeCount,
          pembagianType: formData.pembagianType,
          periodeAmounts: periodeAmountsToSend,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || (isEditing ? 'Failed to update accrual' : 'Failed to create accrual'));
      }

      // Reset form dan tutup modal lebih dulu, lalu alert, lalu background refresh
      setFormData({
        companyCode: '',
        noPo: '',
        assignment: '',
        kdAkr: '',
        kdAkunBiaya: '',
        vendor: '',
        deskripsi: '',
        headerText: '',
        klasifikasi: '',
        totalAmount: '',
        saldoAwal: '',
        costCenter: '',
        startDate: '',
        jumlahPeriode: '12',
        pembagianType: 'otomatis',
        periodeAmounts: [],
      });
      setEditingId(null);
      setShowModal(false);

      alert(isEditing ? 'Data accrual berhasil diupdate!' : 'Data accrual berhasil ditambahkan!');

      // Background refresh tanpa full-page loading spinner
      const accrualRes = await fetch('/api/accrual');
      if (accrualRes.ok) setAccrualData(await accrualRes.json());
    } catch (error) {
      console.error('Error creating accrual:', error);
      alert('Gagal menambahkan data accrual. Silakan coba lagi.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenRealisasiModal = async (periode: AccrualPeriode, viewOnly = false) => {
    setSelectedPeriode(periode);
    setRealisasiViewOnly(viewOnly);
    setShowRealisasiModal(true);
    setLoadingRealisasiData(true);
    setRealisasiData([]); // Clear previous data
    
    // Find the parent accrual item
    const parentAccrual = accrualData.find(acc => 
      acc.periodes?.some(p => p.id === periode.id)
    );
    setCurrentAccrualItem(parentAccrual || null);
    
    // Fetch existing realisasi
    try {
      console.log('Fetching realisasi for periode ID:', periode.id);
      const response = await fetch(`/api/accrual/realisasi?periodeId=${periode.id}`);
      console.log('Response status:', response.status, response.ok);
      if (response.ok) {
        const data = await response.json();
        console.log('Realisasi data fetched:', data);
        setRealisasiData(data);
      } else {
        const errorText = await response.text();
        console.error('Failed to fetch realisasi:', response.status, errorText);
        setRealisasiData([]);
      }
    } catch (error) {
      console.error('Error fetching realisasi:', error);
      setRealisasiData([]);
    } finally {
      setLoadingRealisasiData(false);
    }
  };

  const handleRealisasiInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setRealisasiForm(prev => ({ ...prev, [name]: value }));
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedPeriode) return;

    setUploadingExcel(true);
    try {
      // Kirim ke batch import API (support XML & Excel) - satu request, bukan N request
      const formData = new FormData();
      formData.append('file', file);
      formData.append('periodeId', selectedPeriode.id.toString());

      const response = await fetch('/api/accrual/realisasi/import', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        alert(`Gagal import realisasi: ${result.error}\n${result.details || ''}`);
        return;
      }

      // Tampilkan hasil langsung tanpa menunggu refresh
      const isXml = file.name.toLowerCase().endsWith('.xml');
      let message = `Import ${isXml ? 'XML' : 'Excel'} selesai!\nBerhasil: ${result.successCount} data\nGagal: ${result.errorCount} data`;
      if (result.errors && result.errors.length > 0) {
        message += '\n\nDetail Error:\n' + result.errors.slice(0, 10).join('\n');
        if (result.errors.length > 10) {
          message += `\n... dan ${result.errors.length - 10} error lainnya`;
        }
      }
      alert(message);

      // Background: refresh realisasi & accrual secara paralel (tanpa full-page loading)
      const periodeId = selectedPeriode.id;
      const [realisasiRes, accrualRes] = await Promise.all([
        fetch(`/api/accrual/realisasi?periodeId=${periodeId}`),
        fetch('/api/accrual'),
      ]);
      if (realisasiRes.ok) setRealisasiData(await realisasiRes.json());
      if (accrualRes.ok) {
        const accruals = await accrualRes.json();
        setAccrualData(accruals);
        const updatedAccrual = accruals.find((acc: Accrual) =>
          acc.periodes?.some(p => p.id === periodeId)
        );
        if (updatedAccrual) {
          const updatedPeriode = updatedAccrual.periodes?.find((p: AccrualPeriode) => p.id === periodeId);
          if (updatedPeriode) setSelectedPeriode(updatedPeriode);
        }
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      alert('Gagal mengupload file. Silakan coba lagi.');
    } finally {
      setUploadingExcel(false);
      e.target.value = '';
    }
  };

  const handleRealisasiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPeriode) return;
    
    setSubmittingRealisasi(true);
    try {
      const isEditing = editingRealisasiId !== null;
      const url = isEditing ? `/api/accrual/realisasi?id=${editingRealisasiId}` : '/api/accrual/realisasi';
      const method = isEditing ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accrualPeriodeId: selectedPeriode.id,
          tanggalRealisasi: realisasiForm.tanggalRealisasi,
          amount: parseFloat(realisasiForm.amount),
          headerText: realisasiForm.headerText || null,
          lineText: realisasiForm.lineText || null,
          keterangan: realisasiForm.keterangan || null,
          kdAkunBiaya: realisasiForm.kdAkunBiaya || null,
          costCenter: realisasiForm.costCenter || null,
        }),
      });

      if (!response.ok) throw new Error('Failed to save realisasi');

      // Reset form and editing state
      setRealisasiForm({
        tanggalRealisasi: new Date().toISOString().split('T')[0],
        amount: '',
        headerText: '',
        lineText: '',
        keterangan: '',
        kdAkunBiaya: '',
        costCenter: '',
      });
      setEditingRealisasiId(null);

      alert(isEditing ? 'Realisasi berhasil diupdate!' : 'Realisasi berhasil ditambahkan!');

      // Background: parallel refresh tanpa full-page loading
      const periodeId = selectedPeriode.id;
      const [realisasiRes, accrualRes] = await Promise.all([
        fetch(`/api/accrual/realisasi?periodeId=${periodeId}`),
        fetch('/api/accrual'),
      ]);
      if (realisasiRes.ok) setRealisasiData(await realisasiRes.json());
      if (accrualRes.ok) {
        const accruals = await accrualRes.json();
        setAccrualData(accruals);
        const updatedAccrual = accruals.find((acc: Accrual) =>
          acc.periodes?.some(p => p.id === periodeId)
        );
        if (updatedAccrual) {
          const updatedPeriode = updatedAccrual.periodes?.find((p: AccrualPeriode) => p.id === periodeId);
          if (updatedPeriode) setSelectedPeriode(updatedPeriode);
        }
      }
    } catch (error) {
      console.error('Error saving realisasi:', error);
      alert('Gagal menyimpan realisasi');
    } finally {
      setSubmittingRealisasi(false);
    }
  };

  const handleDeleteRealisasi = async (id: number) => {
    if (!confirm('Apakah Anda yakin ingin menghapus realisasi ini?')) return;

    try {
      const response = await fetch(`/api/accrual/realisasi?id=${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete realisasi');

      // Update local state immediately — no need to wait for heavy re-fetch
      setRealisasiData(prev => prev.filter(r => r.id !== id));

      alert('Realisasi berhasil dihapus!');

      // Background: refresh accrual & realisasi data for accurate computed values
      const periodeId = selectedPeriode?.id;
      const [realisasiRes, accrualRes] = await Promise.all([
        periodeId ? fetch(`/api/accrual/realisasi?periodeId=${periodeId}`) : Promise.resolve(null),
        fetch('/api/accrual'),
      ]);
      if (realisasiRes?.ok) setRealisasiData(await realisasiRes.json());
      if (accrualRes.ok) {
        const accruals = await accrualRes.json();
        setAccrualData(accruals);
        if (periodeId) {
          const updatedAccrual = accruals.find((acc: Accrual) =>
            acc.periodes?.some(p => p.id === periodeId)
          );
          if (updatedAccrual) {
            const updatedPeriode = updatedAccrual.periodes?.find((p: AccrualPeriode) => p.id === periodeId);
            if (updatedPeriode) setSelectedPeriode(updatedPeriode);
          }
        }
      }
    } catch (error) {
      console.error('Error deleting realisasi:', error);
      alert('Gagal menghapus realisasi');
    }
  };

  // Toggle selection realisasi
  const handleToggleRealisasiSelection = (id: number) => {
    setSelectedRealisasiIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // Toggle select all realisasi
  const handleToggleSelectAllRealisasi = () => {
    if (selectedRealisasiIds.size === realisasiData.length) {
      setSelectedRealisasiIds(new Set());
    } else {
      setSelectedRealisasiIds(new Set(realisasiData.map(r => r.id)));
    }
  };

  // Bulk delete realisasi
  const handleBulkDeleteRealisasi = async () => {
    if (selectedRealisasiIds.size === 0) {
      alert('Pilih minimal satu realisasi untuk dihapus');
      return;
    }

    const count = selectedRealisasiIds.size;
    if (!confirm(`Apakah Anda yakin ingin menghapus ${count} realisasi yang dipilih?`)) return;

    setDeletingBulkRealisasi(true);
    try {
      const ids = Array.from(selectedRealisasiIds);

      // Single batch delete request instead of N sequential requests
      const response = await fetch(`/api/accrual/realisasi?ids=${ids.join(',')}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete realisasi');
      const data = await response.json();

      // Update local state immediately
      const deletedSet = new Set(ids);
      setRealisasiData(prev => prev.filter(r => !deletedSet.has(r.id)));
      setSelectedRealisasiIds(new Set());

      alert(`Berhasil menghapus ${data.count ?? ids.length} realisasi!`);

      // Background: refresh in parallel for accurate computed values
      const periodeId = selectedPeriode?.id;
      const [realisasiRes, accrualRes] = await Promise.all([
        periodeId ? fetch(`/api/accrual/realisasi?periodeId=${periodeId}`) : Promise.resolve(null),
        fetch('/api/accrual'),
      ]);
      if (realisasiRes?.ok) setRealisasiData(await realisasiRes.json());
      if (accrualRes.ok) {
        const accruals = await accrualRes.json();
        setAccrualData(accruals);
        if (periodeId) {
          const updatedAccrual = accruals.find((acc: Accrual) =>
            acc.periodes?.some(p => p.id === periodeId)
          );
          if (updatedAccrual) {
            const updatedPeriode = updatedAccrual.periodes?.find((p: AccrualPeriode) => p.id === periodeId);
            if (updatedPeriode) setSelectedPeriode(updatedPeriode);
          }
        }
      }
    } catch (error) {
      console.error('Error bulk deleting realisasi:', error);
      alert('Gagal menghapus realisasi');
    } finally {
      setDeletingBulkRealisasi(false);
    }
  };

  // ── Rincian Accrual per Cost Center ──────────────────────────────────────

  const handleOpenCostCenterModal = async (accrual: Accrual, periode: AccrualPeriode) => {
    setCostCenterModalAccrual(accrual);
    setCostCenterModalPeriode(periode);
    setShowCostCenterModal(true);
    setLoadingCostCenterData(true);
    setCostCenterData([]);
    setEditingCostCenterId(null);
    setSelectedCostCenterIds(new Set());
    setCostCenterForm({ costCenter: '', kdAkunBiaya: '', amount: '', headerText: '', lineText: '', keterangan: '' });
    try {
      const res = await fetch(`/api/accrual/periode-costcenter?periodeId=${periode.id}`);
      if (res.ok) {
        const data = await res.json();
        setCostCenterData(data);
        // Jika belum ada rincian, auto-isi form dari data accrual induk
        if (data.length === 0 && Math.abs(periode.amountAccrual) > 0) {
          setCostCenterForm({
            costCenter: accrual.costCenter || '',
            kdAkunBiaya: accrual.kdAkunBiaya || '',
            amount: Math.abs(periode.amountAccrual).toString(),
            headerText: accrual.headerText || '',
            lineText: '',
            keterangan: '',
          });
        }
      }
    } catch (error) {
      console.error('Error fetching cost center data:', error);
    } finally {
      setLoadingCostCenterData(false);
    }
  };

  const handleCostCenterInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setCostCenterForm(prev => ({ ...prev, [name]: value }));
  };

  const handleCostCenterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!costCenterModalPeriode) return;
    setSubmittingCostCenter(true);
    try {
      const isEditing = editingCostCenterId !== null;
      const url = isEditing
        ? `/api/accrual/periode-costcenter?id=${editingCostCenterId}`
        : '/api/accrual/periode-costcenter';
      const method = isEditing ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accrualPeriodeId: costCenterModalPeriode.id,
          costCenter: costCenterForm.costCenter || null,
          kdAkunBiaya: costCenterForm.kdAkunBiaya || null,
          amount: parseFloat(costCenterForm.amount),
          headerText: costCenterForm.headerText || null,
          lineText: costCenterForm.lineText || null,
          keterangan: costCenterForm.keterangan || null,
        }),
      });

      if (!response.ok) throw new Error('Failed to save entry');

      setCostCenterForm({ costCenter: '', kdAkunBiaya: '', amount: '', headerText: '', lineText: '', keterangan: '' });
      setEditingCostCenterId(null);
      alert(isEditing ? 'Rincian berhasil diupdate!' : 'Rincian berhasil ditambahkan!');

      // Refresh list + accrual data in parallel
      const periodeId = costCenterModalPeriode.id;
      const [listRes, accrualRes] = await Promise.all([
        fetch(`/api/accrual/periode-costcenter?periodeId=${periodeId}`),
        fetch('/api/accrual'),
      ]);
      if (listRes.ok) setCostCenterData(await listRes.json());
      if (accrualRes.ok) {
        const accruals = await accrualRes.json();
        setAccrualData(accruals);
        // Update modal periode with fresh amountAccrual
        const updatedAccrual = accruals.find((a: Accrual) => a.periodes?.some(p => p.id === periodeId));
        if (updatedAccrual) {
          const updatedPeriode = updatedAccrual.periodes?.find((p: AccrualPeriode) => p.id === periodeId);
          if (updatedPeriode) setCostCenterModalPeriode(updatedPeriode);
        }
      }
    } catch (error) {
      console.error('Error saving cost center entry:', error);
      alert('Gagal menyimpan rincian');
    } finally {
      setSubmittingCostCenter(false);
    }
  };

  const handleDeleteCostCenter = async (id: number) => {
    if (!confirm('Hapus rincian ini?')) return;
    try {
      const res = await fetch(`/api/accrual/periode-costcenter?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');

      setCostCenterData(prev => prev.filter(c => c.id !== id));
      alert('Rincian berhasil dihapus!');

      const periodeId = costCenterModalPeriode?.id;
      const [listRes, accrualRes] = await Promise.all([
        periodeId ? fetch(`/api/accrual/periode-costcenter?periodeId=${periodeId}`) : Promise.resolve(null),
        fetch('/api/accrual'),
      ]);
      if (listRes?.ok) setCostCenterData(await listRes.json());
      if (accrualRes.ok) {
        const accruals = await accrualRes.json();
        setAccrualData(accruals);
        if (periodeId) {
          const updatedAccrual = accruals.find((a: Accrual) => a.periodes?.some(p => p.id === periodeId));
          const updatedPeriode = updatedAccrual?.periodes?.find((p: AccrualPeriode) => p.id === periodeId);
          if (updatedPeriode) setCostCenterModalPeriode(updatedPeriode);
        }
      }
    } catch (error) {
      console.error('Error deleting cost center entry:', error);
      alert('Gagal menghapus rincian');
    }
  };

  const handleToggleCostCenterSelection = (id: number) => {
    setSelectedCostCenterIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleToggleSelectAllCostCenter = () => {
    if (selectedCostCenterIds.size === costCenterData.length) {
      setSelectedCostCenterIds(new Set());
    } else {
      setSelectedCostCenterIds(new Set(costCenterData.map(c => c.id)));
    }
  };

  const handleBulkDeleteCostCenter = async () => {
    if (selectedCostCenterIds.size === 0) return;
    if (!confirm(`Hapus ${selectedCostCenterIds.size} rincian terpilih?`)) return;
    setDeletingBulkCostCenter(true);
    try {
      const ids = Array.from(selectedCostCenterIds);
      const res = await fetch(`/api/accrual/periode-costcenter?ids=${ids.join(',')}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      const data = await res.json();

      const deletedSet = new Set(ids);
      setCostCenterData(prev => prev.filter(c => !deletedSet.has(c.id)));
      setSelectedCostCenterIds(new Set());
      alert(`Berhasil menghapus ${data.count ?? ids.length} rincian!`);

      const periodeId = costCenterModalPeriode?.id;
      const [listRes, accrualRes] = await Promise.all([
        periodeId ? fetch(`/api/accrual/periode-costcenter?periodeId=${periodeId}`) : Promise.resolve(null),
        fetch('/api/accrual'),
      ]);
      if (listRes?.ok) setCostCenterData(await listRes.json());
      if (accrualRes.ok) {
        const accruals = await accrualRes.json();
        setAccrualData(accruals);
        if (periodeId) {
          const updatedAccrual = accruals.find((a: Accrual) => a.periodes?.some(p => p.id === periodeId));
          const updatedPeriode = updatedAccrual?.periodes?.find((p: AccrualPeriode) => p.id === periodeId);
          if (updatedPeriode) setCostCenterModalPeriode(updatedPeriode);
        }
      }
    } catch (error) {
      console.error('Error bulk deleting cost center:', error);
      alert('Gagal menghapus rincian');
    } finally {
      setDeletingBulkCostCenter(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────

  const handleCostCenterFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !costCenterModalPeriode) return;
    setUploadingCostCenterFile(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('periodeId', costCenterModalPeriode.id.toString());
      const response = await fetch('/api/accrual/periode-costcenter/import', {
        method: 'POST',
        body: formData,
      });
      const result = await response.json();
      if (!response.ok) {
        alert(`Gagal import: ${result.error}\n${result.details || ''}`);
        return;
      }
      let message = `Import selesai!\nBerhasil: ${result.successCount} data\nGagal: ${result.errorCount} data`;
      if (result.errors && result.errors.length > 0) {
        message += `\n\nDetail error:\n${result.errors.slice(0, 5).join('\n')}`;
        if (result.errors.length > 5) message += `\n...dan ${result.errors.length - 5} error lainnya`;
      }
      alert(message);

      const periodeId = costCenterModalPeriode.id;
      const [listRes, accrualRes] = await Promise.all([
        fetch(`/api/accrual/periode-costcenter?periodeId=${periodeId}`),
        fetch('/api/accrual'),
      ]);
      if (listRes.ok) setCostCenterData(await listRes.json());
      if (accrualRes.ok) {
        const accruals = await accrualRes.json();
        setAccrualData(accruals);
        const updatedAccrual = accruals.find((a: Accrual) => a.periodes?.some((p: AccrualPeriode) => p.id === periodeId));
        const updatedPeriode = updatedAccrual?.periodes?.find((p: AccrualPeriode) => p.id === periodeId);
        if (updatedPeriode) setCostCenterModalPeriode(updatedPeriode);
      }
    } catch (error) {
      console.error('Error uploading cost center file:', error);
      alert('Gagal mengupload file. Silakan coba lagi.');
    } finally {
      setUploadingCostCenterFile(false);
      e.target.value = '';
    }
  };

  const handleGlobalExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingGlobalExcel(true);
    try {
      // Kirim file ke backend untuk parsing (support XML dan Excel)
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/accrual/realisasi/import', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        alert(`Gagal import realisasi: ${result.error}\n${result.details || ''}`);
        return;
      }

      // Tampilkan hasil langsung, lalu refresh di background
      let message = `Import selesai!\nBerhasil: ${result.successCount} data\nGagal: ${result.errorCount} data`;
      if (result.errors && result.errors.length > 0) {
        message += '\n\nDetail Error:\n' + result.errors.slice(0, 10).join('\n');
        if (result.errors.length > 10) {
          message += `\n... dan ${result.errors.length - 10} error lainnya`;
        }
      }
      alert(message);
      setShowImportGlobalModal(false);

      // Background: refresh tanpa full-page loading
      const accrualRes = await fetch('/api/accrual');
      if (accrualRes.ok) setAccrualData(await accrualRes.json());
    } catch (error) {
      console.error('Error uploading file:', error);
      alert('Gagal mengupload file. Silakan coba lagi.');
    } finally {
      setUploadingGlobalExcel(false);
      if (e.target) {
        e.target.value = '';
      }
    }
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingImportExcel(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/accrual/import', {
        method: 'POST',
        body: formData,
      });

      let errorData: any = null;
      let errorText = '';

      if (!response.ok) {
        // Coba parse sebagai JSON, jika gagal ambil sebagai text
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          try {
            errorData = await response.json();
          } catch (jsonError) {
            errorText = await response.text();
          }
        } else {
          errorText = await response.text();
        }

        const warningText =
          errorData?.warnings && Array.isArray(errorData.warnings) && errorData.warnings.length > 0
            ? `\n\nDetail:\n${errorData.warnings.slice(0, 10).join('\n')}${errorData.warnings.length > 10 ? `\n... dan ${errorData.warnings.length - 10} info lainnya` : ''}`
            : '';
        throw new Error((errorData?.error || errorText || 'Failed to import Excel file') + warningText);
      }

      const result = await response.json();
      
      const created = result.createdCount ?? 0;
      const updated = result.updatedCount ?? 0;
      let message = `Import Excel selesai!\n\nBaris diproses: ${result.results.length}`;
      if (created > 0 || updated > 0) {
        message += `\n• Dibuat baru: ${created}\n• Di-update: ${updated}`;
      }
      message += `\n\n(Jika ada baris yang match kode akun + klasifikasi / no PO + vendor, data di-update bukan dibuat baru — total baris di tabel = jumlah accrual unik.)`;
      
      if (result.errors && result.errors.length > 0) {
        message += `\n\nError (${result.errors.length}):\n${result.errors.slice(0, 5).map((e: any) => `${e.kdAkr || 'N/A'}: ${e.error}`).join('\n')}`;
        if (result.errors.length > 5) {
          message += `\n... dan ${result.errors.length - 5} error lainnya`;
        }
      }

      if (result.warnings && result.warnings.length > 0) {
        message += `\n\nWarnings:\n${result.warnings.slice(0, 3).join('\n')}`;
      }

      alert(message);
      setShowImportExcelModal(false);

      // Background refresh tanpa full-page loading spinner
      const accrualRes = await fetch('/api/accrual');
      if (accrualRes.ok) setAccrualData(await accrualRes.json());
    } catch (error) {
      console.error('Error importing Excel file:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      // Jika error message terlalu panjang atau mengandung HTML, potong
      const displayError = errorMessage.length > 200 
        ? errorMessage.substring(0, 200) + '...' 
        : errorMessage.replace(/<[^>]*>/g, ''); // Remove HTML tags
      alert(`Gagal mengimport file Excel: ${displayError}`);
    } finally {
      setUploadingImportExcel(false);
      e.target.value = '';
    }
  };

  const handleUpdatePeriodeAmount = async (periodeId: number, newAmount: string) => {
    try {
      const response = await fetch(`/api/accrual/periode?id=${periodeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountAccrual: Math.abs(parseFloat(newAmount)), // accrual disimpan positif
        }),
      });

      if (!response.ok) throw new Error('Failed to update periode amount');

      setEditingPeriodeId(null);
      setEditPeriodeAmount('');
      alert('Amount periode berhasil diupdate!');

      // Background refresh tanpa full-page loading spinner
      const accrualRes = await fetch('/api/accrual');
      if (accrualRes.ok) setAccrualData(await accrualRes.json());
    } catch (error) {
      console.error('Error updating periode amount:', error);
      alert('Gagal mengupdate amount periode');
    }
  };

  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('id-ID', { year: 'numeric', month: 'short', day: 'numeric' });
  }, []);

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'Pending':
        return 'bg-orange-100 text-orange-700';
      case 'Approved':
        return 'bg-green-100 text-green-700';
      case 'Reversed':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  return (
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
      <div className="flex-1 bg-gray-50 lg:ml-64 overflow-x-hidden">
        {/* Content area - no z-index needed as overlay is conditionally rendered */}
        
        {/* Header */}
        <Header
          title="Monitoring Accrual"
          subtitle="Monitoring dan input data accrual dengan export laporan SAP"
          onMenuClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
        />

        {/* Content Area */}
        <div className="p-4 sm:p-6 md:p-8 bg-gray-50">
          {/* Loading State */}
          {loading ? (
            <div className="flex justify-center items-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600"></div>
            </div>
          ) : (
            <>
              {/* Filter Bar */}
              <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 mb-4 sm:mb-6">
                <div className="flex flex-wrap items-center gap-2 sm:gap-4">
                  {/* Search */}
                  <div className="relative w-full sm:flex-1 sm:min-w-[250px]">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
                    <input
                      type="text"
                      placeholder="Cari berdasarkan..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm"
                    />
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap gap-2 w-full sm:w-auto sm:ml-auto">
                    <button 
                      onClick={() => setShowImportExcelModal(true)}
                      className="flex items-center gap-1 sm:gap-2 bg-red-600 hover:bg-red-700 !text-white px-2 sm:px-4 py-2 rounded-lg transition-colors text-xs sm:text-sm font-medium flex-1 sm:flex-initial justify-center"
                    >
                      <Upload size={16} className="sm:w-[18px] sm:h-[18px]" />
                      <span className="hidden sm:inline">Import Excel Accrual</span>
                      <span className="sm:hidden">Excel</span>
                    </button>
                    <button 
                      onClick={() => setShowImportGlobalModal(true)}
                      className="flex items-center gap-1 sm:gap-2 bg-red-600 hover:bg-red-700 !text-white px-2 sm:px-4 py-2 rounded-lg transition-colors text-xs sm:text-sm font-medium flex-1 sm:flex-initial justify-center"
                    >
                      <Upload size={16} className="sm:w-[18px] sm:h-[18px]" />
                      <span className="hidden sm:inline">Import Realisasi Global</span>
                      <span className="sm:hidden">Import</span>
                    </button>
                    <button 
                      onClick={handleDownloadAllItemsReport}
                      className="flex items-center gap-1 sm:gap-2 bg-red-600 hover:bg-red-700 !text-white px-2 sm:px-4 py-2 rounded-lg transition-colors text-xs sm:text-sm font-medium flex-1 sm:flex-initial justify-center"
                    >
                      <Download size={16} className="sm:w-[18px] sm:h-[18px]" />
                      <span className="hidden sm:inline">Export Per Item (All)</span>
                      <span className="sm:hidden">Per Item</span>
                    </button>
                    <button 
                      onClick={handleDownloadGlobalReport}
                      className="flex items-center gap-1 sm:gap-2 bg-red-600 hover:bg-red-700 !text-white px-2 sm:px-4 py-2 rounded-lg transition-colors text-xs sm:text-sm font-medium flex-1 sm:flex-initial justify-center"
                    >
                      <Download size={16} className="sm:w-[18px] sm:h-[18px]" />
                      <span className="hidden sm:inline">Export Global</span>
                      <span className="sm:hidden">Global</span>
                    </button>
                    {canEdit && selectedIds.size > 0 && (
                      <button
                        onClick={handleDeleteSelected}
                        disabled={deletingSelected}
                        className="flex items-center gap-1 sm:gap-2 bg-red-700 hover:bg-red-800 !text-white px-2 sm:px-4 py-2 rounded-lg transition-colors text-xs sm:text-sm font-medium flex-1 sm:flex-initial justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        <Trash2 size={16} className="sm:w-[18px] sm:h-[18px]" />
                        {deletingSelected ? (
                          <span>Menghapus...</span>
                        ) : (
                          <>
                            <span className="hidden sm:inline">Hapus terpilih ({selectedIds.size})</span>
                            <span className="sm:hidden">Hapus ({selectedIds.size})</span>
                          </>
                        )}
                      </button>
                    )}
                    {canEdit && (
                      <button 
                        onClick={() => setShowModal(true)}
                        className="flex items-center gap-1 sm:gap-2 bg-red-600 hover:bg-red-700 !text-white px-2 sm:px-4 py-2 rounded-lg transition-colors text-xs sm:text-sm font-medium w-full sm:w-auto justify-center"
                      >
                        <Plus size={16} className="sm:w-[18px] sm:h-[18px]" />
                        <span className="hidden sm:inline">Tambah Data Accrual</span>
                        <span className="sm:hidden">Tambah Data</span>
                      </button>
                    )}
                  </div>
                </div>
          </div>

          {/* Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 md:gap-6 mb-4 sm:mb-6 md:mb-8">
            <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
              <p className="text-xs sm:text-sm text-gray-600 mb-1 sm:mb-2">Saldo</p>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-800">
                {formatCurrency(Math.abs(totalSaldo))}
              </h3>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
              <p className="text-xs sm:text-sm text-gray-600 mb-1 sm:mb-2">Jumlah Accrual</p>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-800">{accrualData.length}</h3>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
              <p className="text-xs sm:text-sm text-gray-600 mb-1 sm:mb-2">Total Periode</p>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-800">{totalPeriodes}</h3>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden" style={{ maxWidth: '100%' }}>
            <style jsx>{`
              .custom-scrollbar::-webkit-scrollbar {
                height: 10px;
                width: 10px;
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
              .table-container {
                min-height: calc(100vh - 320px);
                max-height: calc(100vh - 260px);
                overflow: auto;
              }
            `}</style>
            <div
              className="table-container custom-scrollbar"
            >
              <table className="w-full text-sm" style={{ minWidth: '1900px' }}>
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-[5] shadow-sm">
                  <tr>
                    {canEdit && (
                      <th className="px-2 py-4 text-center text-sm font-semibold text-gray-700 whitespace-nowrap w-10 bg-gray-50">
                        <input
                          type="checkbox"
                          checked={filteredData.length > 0 && filteredData.every((item) => selectedIds.has(item.id))}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedIds(new Set(filteredData.map((item) => item.id)));
                            } else {
                              setSelectedIds(new Set());
                            }
                          }}
                          className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                          title="Pilih semua"
                        />
                      </th>
                    )}
                    <th className="px-4 py-4 text-center text-sm font-semibold text-gray-700 whitespace-nowrap w-12 bg-gray-50">
                      ▼
                    </th>
                    <th className="px-4 py-4 text-left text-sm font-semibold text-gray-700 whitespace-nowrap bg-gray-50">
                      Company Code
                    </th>
                    <th className="px-4 py-4 text-left text-sm font-semibold text-gray-700 whitespace-nowrap bg-gray-50">
                      No PO
                    </th>
                    <th className="px-4 py-4 text-left text-sm font-semibold text-gray-700 whitespace-nowrap bg-gray-50">
                      Assignment/Order
                    </th>
                    <th className="px-4 py-4 text-left text-sm font-semibold text-gray-700 whitespace-nowrap bg-gray-50">
                      Kode Akun Accrual
                    </th>
                    <th className="px-4 py-4 text-left text-sm font-semibold text-gray-700 whitespace-nowrap bg-gray-50">
                      Kode Akun Biaya
                    </th>
                    <th className="px-4 py-4 text-left text-sm font-semibold text-gray-700 whitespace-nowrap bg-gray-50">
                      Vendor
                    </th>
                    <th className="px-4 py-4 text-left text-sm font-semibold text-gray-700 whitespace-nowrap bg-gray-50">
                      Deskripsi
                    </th>
                    <th className="px-4 py-4 text-left text-sm font-semibold text-gray-700 whitespace-nowrap bg-gray-50">
                      Header Text
                    </th>
                    <th className="px-4 py-4 text-center text-sm font-semibold text-gray-700 whitespace-nowrap bg-gray-50">
                      Klasifikasi
                    </th>
                    <th className="px-4 py-4 text-right text-sm font-semibold text-gray-700 whitespace-nowrap bg-gray-50">
                      Amount
                    </th>
                    <th className="px-4 py-4 text-left text-sm font-semibold text-gray-700 whitespace-nowrap bg-gray-50">
                      Cost Center
                    </th>
                    <th className="px-4 py-4 text-center text-sm font-semibold text-gray-700 whitespace-nowrap bg-gray-50">
                      Start Date
                    </th>
                    <th className="px-4 py-4 text-center text-sm font-semibold text-gray-700 whitespace-nowrap bg-gray-50">
                      Periode
                    </th>
                    <th className="px-3 py-4 text-right text-sm font-semibold text-gray-700 whitespace-nowrap bg-gray-50" style={{ maxWidth: '140px' }}>
                      Saldo Awal
                    </th>
                    <th className="px-3 py-4 text-right text-sm font-semibold text-gray-700 whitespace-nowrap bg-gray-50" style={{ maxWidth: '140px' }}>
                      Total Accrual
                    </th>
                    <th className="px-3 py-4 text-right text-sm font-semibold text-gray-700 whitespace-nowrap bg-gray-50" style={{ maxWidth: '140px' }}>
                      Total Realisasi
                    </th>
                    <th className="px-3 py-4 text-right text-sm font-semibold text-gray-700 whitespace-nowrap bg-gray-50" style={{ maxWidth: '140px' }}>
                      Saldo
                    </th>
                    <th className="px-4 py-4 text-center text-sm font-semibold text-gray-700 whitespace-nowrap bg-gray-50" style={{ minWidth: '140px' }}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {Object.entries(groupedByKodeAkun).map(([kodeAkun, vendorGroups]) => {
                    const isKodeAkunExpanded = expandedKodeAkun.has(kodeAkun);
                    const allItems = Object.values(vendorGroups).flat();
                    
                    // Calculate totals using cache untuk performa lebih baik; saldo = saldo awal + total accrual - realisasi
                    const totalAmountKodeAkun = allItems.reduce((sum, item) => sum + Math.abs(item.totalAmount || 0), 0);
                    const totalSaldoAwalKodeAkun = allItems.reduce((sum, item) => {
                      const cached = itemTotalsCache.get(item.id);
                      return sum + (cached?.saldoAwal ?? getSaldoAwal(item));
                    }, 0);
                    const totalAccrualKodeAkun = allItems.reduce((sum, item) => {
                      const cached = itemTotalsCache.get(item.id);
                      return sum + (cached?.accrual || 0);
                    }, 0);
                    const totalRealisasiKodeAkun = allItems.reduce((sum, item) => {
                      const cached = itemTotalsCache.get(item.id);
                      return sum + (cached?.realisasi || 0);
                    }, 0);
                    const totalSaldoKodeAkun = totalSaldoAwalKodeAkun + totalAccrualKodeAkun - totalRealisasiKodeAkun;

                    return (
                      <React.Fragment key={kodeAkun}>
                        {/* Kode Akun Group Header */}
                        <tr className="bg-blue-50 font-semibold">
                          {canEdit && <td className="px-2 py-4 bg-blue-50" />}
                          <td className="px-4 py-4 text-center bg-blue-50">
                            <button
                              onClick={() => {
                                const newExpanded = new Set(expandedKodeAkun);
                                if (isKodeAkunExpanded) {
                                  newExpanded.delete(kodeAkun);
                                } else {
                                  newExpanded.add(kodeAkun);
                                }
                                setExpandedKodeAkun(newExpanded);
                              }}
                              className="text-blue-700 hover:text-blue-900 transition-colors"
                            >
                              {isKodeAkunExpanded ? '▼' : '▶'}
                            </button>
                          </td>
                          <td colSpan={9} className="px-4 py-4 text-left text-blue-900 bg-blue-50">
                            Kode Akun: {kodeAkun}
                          </td>
                          <td className="px-4 py-4 text-right font-bold text-blue-900 bg-blue-50">
                            {formatCurrency(totalAmountKodeAkun)}
                          </td>
                          <td className="px-4 py-4 bg-blue-50"></td>
                          <td className="px-4 py-4 bg-blue-50"></td>
                          <td className="px-4 py-4 bg-blue-50"></td>
                          <td className="px-3 py-4 text-right font-bold text-blue-900 bg-blue-50" style={{ maxWidth: '140px' }}>
                            <div className="truncate overflow-hidden text-ellipsis" title={formatCurrency(totalSaldoAwalKodeAkun)}>
                              {formatCurrency(totalSaldoAwalKodeAkun)}
                            </div>
                          </td>
                          <td className="px-3 py-4 text-right font-bold text-blue-900 bg-blue-50" style={{ maxWidth: '140px' }}>
                            <div className="truncate overflow-hidden text-ellipsis" title={formatCurrency(totalAccrualKodeAkun)}>
                              {formatCurrency(totalAccrualKodeAkun)}
                            </div>
                          </td>
                          <td className="px-3 py-4 text-right font-bold text-blue-900 bg-blue-50" style={{ maxWidth: '140px' }}>
                            <div className="truncate overflow-hidden text-ellipsis" title={formatCurrency(totalRealisasiKodeAkun)}>
                              {formatCurrency(totalRealisasiKodeAkun)}
                            </div>
                          </td>
                          <td className="px-3 py-4 text-right font-bold text-blue-900 bg-blue-50" style={{ maxWidth: '140px' }}>
                            <div className="truncate overflow-hidden text-ellipsis" title={formatCurrency(totalSaldoKodeAkun)}>
                              {formatCurrency(totalSaldoKodeAkun)}
                            </div>
                          </td>
                          <td className="px-4 py-4 bg-blue-50">
                            <div className="flex items-center justify-center gap-1">
                              <div className="relative">
                                <button
                                  onClick={() => {
                                    setOpenKodeAkunDropdown(openKodeAkunDropdown === kodeAkun ? null : kodeAkun);
                                  }}
                                  className="text-xs bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded transition-colors flex items-center gap-1"
                                  title="Download Jurnal SAP Kode Akun"
                                >
                                  <Download size={12} />
                                  <ChevronDown size={10} />
                                </button>
                                {openKodeAkunDropdown === kodeAkun && (
                                  <div className="absolute right-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                                    <div className="p-2 space-y-1">
                                      <div className="text-xs font-semibold text-gray-700 mb-2">Pilih Jenis:</div>
                                      
                                      <div className="space-y-1">
                                        <div className="text-xs font-medium text-gray-600">Accrual:</div>
                                        <div className="flex gap-1">
                                          <button
                                            onClick={() => {
                                              const allItems = Object.values(vendorGroups).flat();
                                              promptJurnalTexts((ht, lt) => handleDownloadJurnalSAPPerKodeAkun(kodeAkun, allItems, 'excel', '2000', 'accrual', ht, lt));
                                              setOpenKodeAkunDropdown(null);
                                            }}
                                            className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded transition-colors"
                                          >
                                            Excel 2000
                                          </button>
                                          <button
                                            onClick={() => {
                                              const allItems = Object.values(vendorGroups).flat();
                                              promptJurnalTexts((ht, lt) => handleDownloadJurnalSAPPerKodeAkun(kodeAkun, allItems, 'excel', '7000', 'accrual', ht, lt));
                                              setOpenKodeAkunDropdown(null);
                                            }}
                                            className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded transition-colors"
                                          >
                                            Excel 7000
                                          </button>
                                          <button
                                            onClick={() => {
                                              const allItems = Object.values(vendorGroups).flat();
                                              promptJurnalTexts((ht, lt) => handleDownloadJurnalSAPPerKodeAkun(kodeAkun, allItems, 'txt', '2000', 'accrual', ht, lt));
                                              setOpenKodeAkunDropdown(null);
                                            }}
                                            className="text-xs bg-gray-500 hover:bg-gray-600 text-white px-2 py-1 rounded transition-colors"
                                          >
                                            TXT 2000
                                          </button>
                                          <button
                                            onClick={() => {
                                              const allItems = Object.values(vendorGroups).flat();
                                              promptJurnalTexts((ht, lt) => handleDownloadJurnalSAPPerKodeAkun(kodeAkun, allItems, 'txt', '7000', 'accrual', ht, lt));
                                              setOpenKodeAkunDropdown(null);
                                            }}
                                            className="text-xs bg-gray-500 hover:bg-gray-600 text-white px-2 py-1 rounded transition-colors"
                                          >
                                            TXT 7000
                                          </button>
                                        </div>
                                      </div>
                                      
                                      <div className="space-y-1 pt-2 border-t border-gray-200">
                                        <div className="text-xs font-medium text-gray-600">Realisasi:</div>
                                        <div className="flex gap-1">
                                          <button
                                            onClick={() => {
                                              const allItems = Object.values(vendorGroups).flat();
                                              promptJurnalTexts((ht, lt) => handleDownloadJurnalSAPPerKodeAkun(kodeAkun, allItems, 'excel', '2000', 'realisasi', ht, lt));
                                              setOpenKodeAkunDropdown(null);
                                            }}
                                            className="text-xs bg-green-500 hover:bg-green-600 text-white px-2 py-1 rounded transition-colors"
                                          >
                                            Excel 2000
                                          </button>
                                          <button
                                            onClick={() => {
                                              const allItems = Object.values(vendorGroups).flat();
                                              promptJurnalTexts((ht, lt) => handleDownloadJurnalSAPPerKodeAkun(kodeAkun, allItems, 'excel', '7000', 'realisasi', ht, lt));
                                              setOpenKodeAkunDropdown(null);
                                            }}
                                            className="text-xs bg-green-500 hover:bg-green-600 text-white px-2 py-1 rounded transition-colors"
                                          >
                                            Excel 7000
                                          </button>
                                          <button
                                            onClick={() => {
                                              const allItems = Object.values(vendorGroups).flat();
                                              promptJurnalTexts((ht, lt) => handleDownloadJurnalSAPPerKodeAkun(kodeAkun, allItems, 'txt', '2000', 'realisasi', ht, lt));
                                              setOpenKodeAkunDropdown(null);
                                            }}
                                            className="text-xs bg-gray-500 hover:bg-gray-600 text-white px-2 py-1 rounded transition-colors"
                                          >
                                            TXT 2000
                                          </button>
                                          <button
                                            onClick={() => {
                                              const allItems = Object.values(vendorGroups).flat();
                                              promptJurnalTexts((ht, lt) => handleDownloadJurnalSAPPerKodeAkun(kodeAkun, allItems, 'txt', '7000', 'realisasi', ht, lt));
                                              setOpenKodeAkunDropdown(null);
                                            }}
                                            className="text-xs bg-gray-500 hover:bg-gray-600 text-white px-2 py-1 rounded transition-colors"
                                          >
                                            TXT 7000
                                          </button>
                                        </div>
                                      </div>
                                      
                                      <div className="space-y-1 pt-2 border-t border-gray-200">
                                        <div className="text-xs font-medium text-gray-600">Detail per Cost Center:</div>
                                        <div className="flex gap-1">
                                          <button
                                            onClick={() => {
                                              handleDownloadJurnalDetail(kodeAkun);
                                              setOpenKodeAkunDropdown(null);
                                            }}
                                            className="text-xs bg-purple-500 hover:bg-purple-600 text-white px-2 py-1 rounded transition-colors flex-1"
                                          >
                                            Download Detail (TXT)
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>

                        {isKodeAkunExpanded && Object.entries(vendorGroups).map(([vendor, items]) => {
                          const vendorKey = `${kodeAkun}-${vendor}`;
                          const isVendorExpanded = expandedVendor.has(vendorKey);
                          
                          // Calculate totals using cache untuk performa
                          const totalAmountVendor = items.reduce((sum, item) => sum + Math.abs(item.totalAmount || 0), 0);
                          const totalAccrualVendor = items.reduce((sum, item) => {
                            const cached = itemTotalsCache.get(item.id);
                            return sum + (cached?.accrual || 0);
                          }, 0);
                          const totalRealisasiVendor = items.reduce((sum, item) => {
                            const cached = itemTotalsCache.get(item.id);
                            return sum + (cached?.realisasi || 0);
                          }, 0);
                          const totalSaldoAwalVendor = items.reduce((sum, item) => {
                            const cached = itemTotalsCache.get(item.id);
                            return sum + (cached?.saldoAwal ?? getSaldoAwal(item));
                          }, 0);
                          const totalSaldoVendor = totalSaldoAwalVendor + totalAccrualVendor - totalRealisasiVendor;

                          return (
                            <React.Fragment key={vendorKey}>
                              <tr className="bg-green-50 font-semibold">
                                {canEdit && <td className="px-2 py-4 bg-green-50" />}
                                <td className="px-4 py-4 text-center bg-green-50">
                                  <button
                                    onClick={() => {
                                      const newExpanded = new Set(expandedVendor);
                                      if (isVendorExpanded) {
                                        newExpanded.delete(vendorKey);
                                      } else {
                                        newExpanded.add(vendorKey);
                                      }
                                      setExpandedVendor(newExpanded);
                                    }}
                                    className="text-green-700 hover:text-green-900 transition-colors ml-4"
                                  >
                                    {isVendorExpanded ? '▼' : '▶'}
                                  </button>
                                </td>
                                <td colSpan={9} className="px-4 py-4 text-left text-green-900 bg-green-50">
                                  Vendor: {vendor}
                                </td>
                                <td className="px-4 py-4 text-right font-bold text-green-900 bg-green-50">
                                  {formatCurrency(totalAmountVendor)}
                                </td>
                                <td className="px-4 py-4 bg-green-50"></td>
                                <td className="px-4 py-4 bg-green-50"></td>
                                <td className="px-4 py-4 bg-green-50"></td>
                                <td className="px-3 py-4 text-right font-bold text-green-900 bg-green-50" style={{ maxWidth: '140px' }}>
                                  <div className="truncate overflow-hidden text-ellipsis" title={formatCurrency(totalSaldoAwalVendor)}>
                                    {formatCurrency(totalSaldoAwalVendor)}
                                  </div>
                                </td>
                                <td className="px-3 py-4 text-right font-bold text-green-900 bg-green-50" style={{ maxWidth: '140px' }}>
                                  <div className="truncate overflow-hidden text-ellipsis" title={formatCurrency(totalAccrualVendor)}>
                                    {formatCurrency(totalAccrualVendor)}
                                  </div>
                                </td>
                                <td className="px-3 py-4 text-right font-bold text-green-900 bg-green-50" style={{ maxWidth: '140px' }}>
                                  <div className="truncate overflow-hidden text-ellipsis" title={formatCurrency(totalRealisasiVendor)}>
                                    {formatCurrency(totalRealisasiVendor)}
                                  </div>
                                </td>
                                <td className="px-3 py-4 text-right font-bold text-green-900 bg-green-50" style={{ maxWidth: '140px' }}>
                                  <div className="truncate overflow-hidden text-ellipsis" title={formatCurrency(totalSaldoVendor)}>
                                    {formatCurrency(totalSaldoVendor)}
                                  </div>
                                </td>
                                <td className="px-4 py-4 bg-green-50"></td>
                              </tr>

                              {isVendorExpanded && items.map((item) => {
                          const isExpanded = expandedRows.has(item.id);
                          return (
                            <React.Fragment key={item.id}>
                              <tr className="bg-white hover:bg-gray-50 transition-colors">
                                {canEdit && (
                                  <td className="px-2 py-4 text-center bg-white">
                                    <input
                                      type="checkbox"
                                      checked={selectedIds.has(item.id)}
                                      onChange={() => {
                                        setSelectedIds((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(item.id)) next.delete(item.id);
                                          else next.add(item.id);
                                          return next;
                                        });
                                      }}
                                      className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  </td>
                                )}
                                <td className="px-4 py-4 text-center bg-white">
                                  <button
                                    onClick={() => {
                                      const newExpanded = new Set(expandedRows);
                                      if (isExpanded) {
                                        newExpanded.delete(item.id);
                                      } else {
                                        newExpanded.add(item.id);
                                      }
                                      setExpandedRows(newExpanded);
                                    }}
                                    className="text-gray-600 hover:text-red-600 transition-colors ml-6"
                                  >
                                    {isExpanded ? '▼' : '▶'}
                                  </button>
                                </td>
                          <td className="px-4 py-4 text-gray-800 whitespace-nowrap bg-white">{item.companyCode || '-'}</td>
                          <td className="px-4 py-4 text-gray-800 whitespace-nowrap bg-white">{item.noPo || '-'}</td>
                          <td className="px-4 py-4 text-gray-800 whitespace-nowrap bg-white">{item.alokasi || '-'}</td>
                          <td className="px-4 py-4 text-gray-800 whitespace-nowrap font-medium bg-white">{item.kdAkr}</td>
                          <td className="px-4 py-4 text-gray-800 bg-white">{item.kdAkunBiaya}</td>
                          <td className="px-4 py-4 text-gray-600 bg-white">{item.vendor}</td>
                          <td className="px-4 py-4 text-gray-600 max-w-xs truncate bg-white" title={item.deskripsi}>{item.deskripsi}</td>
                          <td className="px-4 py-4 text-gray-600 max-w-xs truncate bg-white" title={item.headerText || '-'}>{item.headerText || '-'}</td>
                          <td className="px-4 py-4 text-center bg-white">
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                              {item.klasifikasi || '-'}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-right font-medium text-gray-800 whitespace-nowrap bg-white">
                            {formatCurrency(Math.abs(item.totalAmount))}
                          </td>
                          <td className="px-4 py-4 text-gray-800 whitespace-nowrap bg-white">{item.costCenter || '-'}</td>
                          <td className="px-4 py-4 text-center text-gray-600 text-xs whitespace-nowrap bg-white">
                            {formatDate(item.startDate)}
                          </td>
                          <td className="px-4 py-4 text-center text-gray-800 whitespace-nowrap bg-white">
                            {item.jumlahPeriode} bulan
                          </td>
                          <td className="px-2 py-4 text-right font-medium text-gray-800 whitespace-nowrap bg-white" style={{ maxWidth: '140px' }}>
                            <div className="truncate overflow-hidden text-ellipsis" title={formatCurrency(getSaldoAwal(item))}>
                              {formatCurrency(getSaldoAwal(item))}
                            </div>
                          </td>
                          <td className="px-2 py-4 text-right font-medium text-gray-800 whitespace-nowrap bg-white" style={{ maxWidth: '140px' }}>
                            <div className="truncate overflow-hidden text-ellipsis" title={formatCurrency(calculateItemAccrual(item))}>
                              {formatCurrency(calculateItemAccrual(item))}
                            </div>
                          </td>
                          <td className="px-2 py-4 text-right text-blue-700 whitespace-nowrap bg-white" style={{ maxWidth: '140px' }}>
                            <div className="truncate overflow-hidden text-ellipsis" title={formatCurrency(calculateActualRealisasi(item))}>
                              {formatCurrency(calculateActualRealisasi(item))}
                            </div>
                          </td>
                          <td className="px-2 py-4 text-right font-semibold text-gray-800 whitespace-nowrap bg-white" style={{ maxWidth: '140px' }}>
                            <div className="truncate overflow-hidden text-ellipsis" title={formatCurrency(calculateItemSaldo(item, calculateItemAccrual(item), calculateActualRealisasi(item)))}>
                              {formatCurrency(calculateItemSaldo(item, calculateItemAccrual(item), calculateActualRealisasi(item)))}
                            </div>
                          </td>
                          <td className="px-4 py-4 text-center bg-white">
                            <div className="flex items-center justify-center gap-1">
                              {canEdit && (
                                <>
                                  <button
                                    onClick={() => handleEdit(item)}
                                    className="text-blue-600 hover:text-blue-800 transition-colors p-1 hover:bg-blue-50 rounded"
                                    title="Edit"
                                  >
                                    <Edit2 size={16} />
                                  </button>
                                  <button
                                    onClick={() => handleDelete(item.id)}
                                    className="text-red-600 hover:text-red-800 transition-colors p-1 hover:bg-red-50 rounded"
                                    title="Hapus"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                        
                        {/* Expanded Row - Periode Details */}
                        {isExpanded && item.periodes && item.periodes.length > 0 && (
                          <tr className="bg-gray-50">
                            <td colSpan={canEdit ? 20 : 19} className="px-4 py-4 bg-gray-50">
                              <div className="ml-8">
                                <h4 className="text-sm font-semibold text-gray-700 mb-3">Detail Periode</h4>
                                <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
                                  <thead className="bg-white">
                                    <tr>
                                      <th className="px-4 py-3 text-left font-semibold text-gray-700 bg-white" style={{ width: '90px' }}>Periode</th>
                                      <th className="px-4 py-3 text-left font-semibold text-gray-700 bg-white" style={{ width: '120px' }}>Bulan</th>
                                      <th className="px-4 py-3 text-right font-semibold text-gray-700 bg-white" style={{ maxWidth: '150px' }}>Accrual</th>
                                      <th className="px-4 py-3 text-right font-semibold text-blue-700 bg-white" style={{ maxWidth: '150px' }}>Total Realisasi</th>
                                      <th className="px-4 py-3 text-right font-semibold text-gray-700 bg-white" style={{ maxWidth: '150px' }}>Saldo</th>
                                      <th className="px-4 py-3 text-center font-semibold text-gray-700 bg-white" style={{ minWidth: '220px' }}>Action</th>
                                    </tr>
                                  </thead>
                                  <tbody className="bg-white divide-y divide-gray-200">
                                    {item.periodes?.map((periode) => (
                                      <React.Fragment key={periode.id}>
                                      <tr className="hover:bg-gray-50">
                                        <td className="px-4 py-3 text-gray-700 bg-white">Periode {periode.periodeKe}</td>
                                        <td className="px-4 py-3 text-gray-700 bg-white">{periode.bulan}</td>
                                        <td className="px-4 py-3 text-right text-gray-800 font-medium bg-white" style={{ maxWidth: '150px' }}>
                                          <span className="truncate overflow-hidden text-ellipsis" title={formatCurrency(Math.abs(periode.amountAccrual))}>
                                            {formatCurrency(Math.abs(periode.amountAccrual))}
                                          </span>
                                        </td>
                                        <td className="px-4 py-3 text-right text-blue-700 bg-white" style={{ maxWidth: '150px' }}>
                                          <span className="truncate block overflow-hidden text-ellipsis" title={formatCurrency(periode.totalRealisasi || 0)}>
                                            {formatCurrency(periode.totalRealisasi || 0)}
                                          </span>
                                        </td>
                                        <td className="px-4 py-3 text-right text-gray-800 font-semibold bg-white" style={{ maxWidth: '150px' }}>
                                          <span className="truncate block overflow-hidden text-ellipsis" title={formatCurrency(periode.saldo || 0)}>
                                            {formatCurrency(periode.saldo || 0)}
                                          </span>
                                        </td>
                                        <td className="px-4 py-3 text-center bg-white">
                                          <div className="flex items-center justify-center gap-1">
                                            <button
                                              onClick={() => handleOpenCostCenterModal(item, periode)}
                                              className="text-xs bg-amber-500 hover:bg-amber-600 text-white px-3 py-1 rounded transition-colors"
                                              title="Rincian accrual per cost center"
                                            >
                                              Rincian Accrual
                                            </button>
                                            <button
                                              onClick={() => handleOpenRealisasiModal(periode, false)}
                                              className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded transition-colors"
                                              title="Input realisasi baru"
                                            >
                                              Input Realisasi
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                      </React.Fragment>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                            </React.Fragment>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Empty State */}
            {Object.keys(groupedByKodeAkun).length === 0 && (
              <div className="text-center py-12">
                <p className="text-gray-500">Tidak ada data yang ditemukan</p>
              </div>
            )}
          </div>
            </>
          )}
        </div>
      </div>

      {/* Modal Form Tambah Data Accrual */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4">
          <div className="bg-white rounded-xl sm:rounded-2xl shadow-2xl max-w-4xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-hidden">
            {/* Modal Header */}
            <div className="sticky top-0 bg-gradient-to-r from-red-600 to-red-700 px-6 py-5 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">{editingId ? 'Edit Data Accrual' : 'Tambah Data Accrual'}</h2>
              <button
                onClick={() => {
                  setShowModal(false);
                  setEditingId(null);
                  setFormData({
                    companyCode: '',
                    noPo: '',
                    assignment: '',
                    kdAkr: '',
                    kdAkunBiaya: '',
                    vendor: '',
                    deskripsi: '',
                    headerText: '',
                    klasifikasi: '',
                    totalAmount: '',
                    saldoAwal: '',
                    costCenter: '',
                    startDate: '',
                    jumlahPeriode: '12',
                    pembagianType: 'otomatis',
                    periodeAmounts: [],
                  });
                }}
                className="text-white hover:text-red-100 transition-colors rounded-full hover:bg-white/10 p-1"
              >
                <X size={24} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="overflow-y-auto" style={{ maxHeight: 'calc(95vh - 120px)' }}>
              <form onSubmit={handleSubmit} className="p-3 sm:p-6 bg-gray-50">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-6 mb-4 sm:mb-6">
                {/* Company Code */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Company Code</label>
                  <select
                    name="companyCode"
                    value={formData.companyCode}
                    onChange={handleInputChange}
                    className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                  >
                    <option value="">Pilih Company Code</option>
                    <option value="2000">2000</option>
                    <option value="7000">7000</option>
                  </select>
                </div>

                {/* No PO */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">No PO</label>
                  <input
                    type="text"
                    name="noPo"
                    value={formData.noPo}
                    onChange={handleInputChange}
                    className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                    placeholder="Masukkan nomor PO"
                  />
                </div>

                {/* Assignment/Order */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Assignment/Order</label>
                  <input
                    type="text"
                    name="assignment"
                    value={formData.assignment}
                    onChange={handleInputChange}
                    className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                    placeholder="Masukkan assignment/order"
                  />
                </div>

                {/* Kode Akun Accrual */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Kode Akun Accrual</label>
                  <select
                    name="kdAkr"
                    value={formData.kdAkr}
                    onChange={handleInputChange}
                    className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                  >
                    <option value="">Pilih Kode Akun</option>
                    {Object.keys(KODE_AKUN_KLASIFIKASI).map((kodeAkun) => (
                      <option key={kodeAkun} value={kodeAkun}>
                        {kodeAkun}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Kode Akun Biaya */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Kode Akun Biaya</label>
                  <input
                    type="text"
                    name="kdAkunBiaya"
                    value={formData.kdAkunBiaya}
                    onChange={handleInputChange}
                    className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                    placeholder="Masukkan kode akun biaya"
                  />
                </div>

                {/* Vendor */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Vendor</label>
                  <input
                    type="text"
                    name="vendor"
                    value={formData.vendor}
                    onChange={handleInputChange}
                    className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                    placeholder="Masukkan nama vendor"
                  />
                </div>

                {/* Klasifikasi */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Klasifikasi</label>
                  <input
                    type="text"
                    name="klasifikasi"
                    value={formData.klasifikasi}
                    onChange={handleInputChange}
                    list="klasifikasi-list"
                    disabled={!formData.kdAkr}
                    className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all disabled:bg-gray-100 disabled:cursor-not-allowed"
                    placeholder={!formData.kdAkr ? 'Pilih Kode Akun terlebih dahulu' : 'Pilih atau ketik klasifikasi baru'}
                  />
                  <datalist id="klasifikasi-list">
                    {availableKlasifikasi.map((klasifikasi) => (
                      <option key={klasifikasi} value={klasifikasi} />
                    ))}
                  </datalist>
                  {formData.kdAkr && availableKlasifikasi.length > 0 && (
                    <p className="text-xs text-gray-500 mt-1">
                      Pilih dari daftar atau ketik klasifikasi baru
                    </p>
                  )}
                </div>

                {/* Amount */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Amount</label>
                  {formData.pembagianType === 'manual' && (
                    <p className="text-xs text-gray-500 mb-1">Total accrual bisa diisi per periode di bawah</p>
                  )}
                  <input
                    type="number"
                    name="totalAmount"
                    value={formData.totalAmount}
                    onChange={handleInputChange}
                    min="0"
                    step="0.01"
                    className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                    placeholder="Contoh: 50000000"
                  />
                </div>

                {/* Saldo Awal - sesuai kolom tabel */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Saldo Awal</label>
                  <p className="text-xs text-gray-500 mb-1">Nilai tetap dari import (saldo akhir/outstanding)</p>
                  <input
                    type="number"
                    name="saldoAwal"
                    value={formData.saldoAwal}
                    onChange={handleInputChange}
                    min="0"
                    step="0.01"
                    className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                    placeholder="Opsional"
                  />
                </div>

                {/* Jumlah Periode */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Jumlah Periode</label>
                  <input
                    type="number"
                    name="jumlahPeriode"
                    value={formData.jumlahPeriode}
                    onChange={handleInputChange}
                    min="1"
                    max="36"
                    className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                    placeholder="Contoh: 12 (bulan)"
                  />
                </div>

                {/* Cost Center */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Cost Center</label>
                  <input
                    type="text"
                    name="costCenter"
                    value={formData.costCenter}
                    onChange={handleInputChange}
                    className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                    placeholder="Masukkan cost center"
                  />
                </div>

                {/* Start Date */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Start Date</label>
                  <input
                    type="date"
                    name="startDate"
                    value={formData.startDate}
                    onChange={handleInputChange}
                    className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                  />
                </div>

                {/* Pembagian Type - Full Width */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Tipe Pembagian Periode</label>
                  <div className="flex gap-6">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="radio"
                        name="pembagianType"
                        value="otomatis"
                        checked={formData.pembagianType === 'otomatis'}
                        onChange={handleInputChange}
                        className="w-4 h-4 text-red-600 focus:ring-red-500"
                      />
                      <span className="ml-2 text-sm text-gray-700">
                        <strong>Otomatis</strong> - Dibagi rata per periode
                      </span>
                    </label>
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="radio"
                        name="pembagianType"
                        value="manual"
                        checked={formData.pembagianType === 'manual'}
                        onChange={handleInputChange}
                        className="w-4 h-4 text-red-600 focus:ring-red-500"
                      />
                      <span className="ml-2 text-sm text-gray-700">
                        <strong>Manual</strong> - Isi amount per periode di bawah
                      </span>
                    </label>
                  </div>
                </div>

                {/* Deskripsi - Full Width */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Deskripsi</label>
                  <textarea
                    name="deskripsi"
                    value={formData.deskripsi}
                    onChange={handleInputChange}
                    rows={3}
                    className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all resize-none"
                    placeholder="Masukkan deskripsi accrual"
                  />
                </div>

                {/* Header Text - Full Width */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Header Text
                  </label>
                  <input
                    type="text"
                    name="headerText"
                    value={formData.headerText}
                    onChange={handleInputChange}
                    className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                    placeholder="Masukkan header text untuk jurnal SAP (opsional)"
                  />
                </div>
              </div>

              {/* Form Actions */}
              <div className="flex items-center justify-end gap-3 pt-6 border-t border-gray-200 bg-white px-6 py-4 -mx-6 -mb-6 rounded-b-2xl">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditingId(null);
                    setFormData({
                      companyCode: '',
                      noPo: '',
                      assignment: '',
                      kdAkr: '',
                      kdAkunBiaya: '',
                      vendor: '',
                      deskripsi: '',
                      headerText: '',
                      klasifikasi: '',
                      totalAmount: '',
                      saldoAwal: '',
                      costCenter: '',
                      startDate: '',
                      jumlahPeriode: '12',
                      pembagianType: 'otomatis',
                      periodeAmounts: [],
                    });
                  }}
                  className="px-5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors"
                  disabled={submitting}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-red-500/30"
                >
                  {submitting ? 'Menyimpan...' : editingId ? 'Update Data' : 'Simpan Data'}
                </button>
              </div>
            </form>
            </div>
          </div>
        </div>
      )}

      {/* Modal Input Realisasi */}
      {showRealisasiModal && selectedPeriode && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4">
          <div className="bg-white rounded-xl sm:rounded-2xl shadow-2xl max-w-3xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-hidden">
            {/* Modal Header */}
            <div className="sticky top-0 bg-gradient-to-r from-red-600 to-red-700 px-6 py-5 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">
                  {realisasiViewOnly ? 'History Realisasi' : 'Input Realisasi'}
                </h2>
                <p className="text-sm text-red-100 mt-1">
                  {selectedPeriode.bulan} - Periode {selectedPeriode.periodeKe}
                  {realisasiViewOnly && ' (Sudah Terpenuhi)'}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowRealisasiModal(false);
                  setSelectedPeriode(null);
                  setRealisasiViewOnly(false);
                  setRealisasiData([]);
                  setLoadingRealisasiData(false);
                  setSelectedRealisasiIds(new Set());
                  setRealisasiForm({
                    tanggalRealisasi: new Date().toISOString().split('T')[0],
                    amount: '',
                    headerText: '',
                    lineText: '',
                    keterangan: '',
                    kdAkunBiaya: '',
                    costCenter: '',
                  });
                }}
                className="text-white hover:text-red-100 transition-colors rounded-full hover:bg-white/10 p-1"
              >
                <X size={24} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="overflow-y-auto p-6 bg-gray-50" style={{ maxHeight: 'calc(90vh - 180px)' }}>
              {/* Info Periode */}
              <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Accrual</p>
                    <p className="text-lg font-bold text-gray-800">{formatCurrency(Math.abs(selectedPeriode.amountAccrual))}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Total Realisasi</p>
                    <p className="text-lg font-bold text-blue-700">{formatCurrency(selectedPeriode.totalRealisasi || 0)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Saldo</p>
                    <p className="text-lg font-bold text-red-700">{formatCurrency(Math.abs((selectedPeriode as any).saldo || selectedPeriode.saldo || 0))}</p>
                  </div>
                </div>
              </div>

              {/* Notif jika view only */}
              {realisasiViewOnly && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                  <div className="flex items-center gap-2 text-green-800">
                    <div>
                      <p className="font-semibold">Accrual Sudah Terpenuhi</p>
                      <p className="text-sm">Periode ini sudah direalisasi sepenuhnya. Anda hanya dapat melihat history realisasi.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Upload Excel/XML */}
              {!realisasiViewOnly && (
              <div className="bg-white rounded-lg border border-gray-200 p-5 mb-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Import dari File</h3>
                <div className="flex items-center gap-3">
                  <label className="flex-1 cursor-pointer">
                    <div className="flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-all">
                      <Upload size={18} />
                      <span className="text-sm font-medium">
                        {uploadingExcel ? 'Mengupload...' : 'Upload File (Excel/XML)'}
                      </span>
                    </div>
                    <input
                      type="file"
                      accept=".xlsx,.xls,.xml"
                      onChange={handleExcelUpload}
                      disabled={uploadingExcel}
                      className="hidden"
                    />
                  </label>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  * Support: Excel (.xlsx, .xls) dan XML SAP report
                </p>
              </div>
              )}

              {/* Form Input Realisasi */}
              {!realisasiViewOnly && (
              <form onSubmit={handleRealisasiSubmit} className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Tambah Realisasi Manual</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Tanggal Realisasi <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="date"
                      name="tanggalRealisasi"
                      value={realisasiForm.tanggalRealisasi}
                      onChange={handleRealisasiInputChange}
                      required
                      className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Amount <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="number"
                      name="amount"
                      value={realisasiForm.amount}
                      onChange={handleRealisasiInputChange}
                      required
                      min="0"
                      step="0.01"
                      className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                      placeholder="Masukkan amount realisasi"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Kode Akun Biaya
                    </label>
                    <input
                      type="text"
                      name="kdAkunBiaya"
                      value={realisasiForm.kdAkunBiaya}
                      onChange={handleRealisasiInputChange}
                      className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                      placeholder="Masukkan kode akun biaya"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Cost Center
                    </label>
                    <input
                      type="text"
                      name="costCenter"
                      value={realisasiForm.costCenter}
                      onChange={handleRealisasiInputChange}
                      className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                      placeholder="Masukkan cost center"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Header Text (bktxt)
                    </label>
                    <input
                      type="text"
                      name="headerText"
                      value={realisasiForm.headerText}
                      onChange={handleRealisasiInputChange}
                      className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                      placeholder="Document header text"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Line Text (sgtxt)
                    </label>
                    <input
                      type="text"
                      name="lineText"
                      value={realisasiForm.lineText}
                      onChange={handleRealisasiInputChange}
                      className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm transition-all"
                      placeholder="Line text"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  {editingRealisasiId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingRealisasiId(null);
                        setRealisasiForm({
                          tanggalRealisasi: new Date().toISOString().split('T')[0],
                          amount: '',
                          headerText: '',
                          lineText: '',
                          keterangan: '',
                          kdAkunBiaya: '',
                          costCenter: '',
                        });
                      }}
                      className="px-5 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                      Batal
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={submittingRealisasi}
                    className="px-5 py-2.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-red-500/30"
                  >
                    {submittingRealisasi ? 'Menyimpan...' : editingRealisasiId ? 'Update Realisasi' : 'Simpan Realisasi'}
                  </button>
                </div>
              </form>
              )}

              {/* List Realisasi */}
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-gray-700">History Realisasi</h3>
                    {realisasiData.length > 0 && (
                      <span className="text-xs text-gray-500">({realisasiData.length} data)</span>
                    )}
                  </div>
                  {!realisasiViewOnly && realisasiData.length > 0 && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleToggleSelectAllRealisasi}
                        className="text-xs px-3 py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded transition-colors"
                        title={selectedRealisasiIds.size === realisasiData.length ? 'Batal Pilih Semua' : 'Pilih Semua'}
                      >
                        {selectedRealisasiIds.size === realisasiData.length ? '✓ Semua' : 'Pilih Semua'}
                      </button>
                      {selectedRealisasiIds.size > 0 && (
                        <>
                          <span className="text-xs text-gray-600">
                            {selectedRealisasiIds.size} terpilih
                          </span>
                          <button
                            onClick={handleBulkDeleteRealisasi}
                            disabled={deletingBulkRealisasi}
                            className="text-xs px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                          >
                            <Trash2 size={12} />
                            {deletingBulkRealisasi ? 'Menghapus...' : 'Hapus Terpilih'}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {loadingRealisasiData ? (
                  <div className="p-8 text-center">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-red-600"></div>
                    <p className="text-gray-500 text-sm mt-2">Memuat history realisasi...</p>
                  </div>
                ) : realisasiData.length === 0 ? (
                  <div className="p-8 text-center text-gray-500 text-sm">
                    Belum ada realisasi untuk periode ini
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    {/* Group realisasi by Cost Element */}
                    {(() => {
                      // Group by kdAkunBiaya
                      const grouped = realisasiData.reduce((acc, realisasi) => {
                        const key = realisasi.kdAkunBiaya || 'N/A';
                        if (!acc[key]) acc[key] = [];
                        acc[key].push(realisasi);
                        return acc;
                      }, {} as Record<string, RealisasiData[]>);

                      return Object.entries(grouped).map(([costElement, items]) => {
                        const hasMultiple = items.length > 1;
                        const isExpanded = expandedCostElements.has(costElement);
                        const totalAmount = items.reduce((sum, item) => sum + Math.abs(item.amount), 0);

                        return (
                          <div key={costElement} className="mb-4 border border-gray-200 rounded-lg overflow-hidden">
                            {/* Header Row - Cost Element Summary */}
                            <div className="bg-gradient-to-r from-blue-50 to-blue-100 px-4 py-3 flex items-center justify-between">
                              <div 
                                className={`flex items-center gap-3 flex-1 ${hasMultiple ? 'cursor-pointer' : ''}`}
                                onClick={() => {
                                  if (hasMultiple) {
                                    const newExpanded = new Set(expandedCostElements);
                                    if (newExpanded.has(costElement)) {
                                      newExpanded.delete(costElement);
                                    } else {
                                      newExpanded.add(costElement);
                                    }
                                    setExpandedCostElements(newExpanded);
                                  }
                                }}
                              >
                                {hasMultiple && (
                                  <div className="text-blue-600">
                                    {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                  </div>
                                )}
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium text-blue-700">Cost Element:</span>
                                    <span className="font-mono font-bold text-sm text-blue-900">{costElement}</span>
                                    <span className="text-xs text-blue-600">({items.length} transaksi)</span>
                                  </div>
                                  {hasMultiple && (
                                    <div className="text-xs text-blue-600 mt-1">
                                      {items.length} Cost Center berbeda • Total: {formatCurrency(totalAmount)}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                {/* Download Button untuk semua transaksi dalam group */}
                                {!realisasiViewOnly && (
                                  <div className="relative">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (openGroupDropdown?.key === costElement) {
                                          setOpenGroupDropdown(null);
                                        } else {
                                          const rect = e.currentTarget.getBoundingClientRect();
                                          setOpenGroupDropdown({ key: costElement, items, accrualItem: currentAccrualItem!, rect: { top: rect.bottom, right: window.innerWidth - rect.right } });
                                        }
                                      }}
                                      className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded transition-colors flex items-center gap-1 shadow-sm"
                                      title="Download Jurnal SAP untuk semua transaksi dalam Cost Element ini"
                                    >
                                      <Download size={14} />
                                      <span className="font-medium">Download Jurnal</span>
                                      <ChevronDown size={12} />
                                    </button>
                                  </div>
                                )}
                                <div className="text-right">
                                  <div className="text-lg font-bold text-blue-900">{formatCurrency(totalAmount)}</div>
                                </div>
                              </div>
                            </div>

                            {/* Detail Table - Show if single item OR expanded */}
                            {(!hasMultiple || isExpanded) && (
                              <table className="w-full text-sm">
                                <thead className="bg-gray-50 border-b border-gray-200">
                                  <tr>
                                    {!realisasiViewOnly && (
                                      <th className="px-3 py-2 text-center text-xs font-semibold text-gray-700 w-10">
                                        <input
                                          type="checkbox"
                                          checked={items.every(item => selectedRealisasiIds.has(item.id))}
                                          onChange={() => {
                                            const allSelected = items.every(item => selectedRealisasiIds.has(item.id));
                                            const newSet = new Set(selectedRealisasiIds);
                                            items.forEach(item => {
                                              if (allSelected) {
                                                newSet.delete(item.id);
                                              } else {
                                                newSet.add(item.id);
                                              }
                                            });
                                            setSelectedRealisasiIds(newSet);
                                          }}
                                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                          title="Pilih semua dalam group ini"
                                        />
                                      </th>
                                    )}
                                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">Tanggal</th>
                                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700">Amount</th>
                                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 bg-yellow-50">Cost Center</th>
                                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">Header Text</th>
                                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">Line Text</th>
                                    {!realisasiViewOnly && (
                                      <th className="px-4 py-2 text-center text-xs font-semibold text-gray-700">Action</th>
                                    )}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {items.map((realisasi) => (
                                    <tr key={realisasi.id} className={`hover:bg-blue-50 transition-colors ${selectedRealisasiIds.has(realisasi.id) ? 'bg-blue-50' : ''}`}>
                                      {!realisasiViewOnly && (
                                        <td className="px-3 py-2 text-center">
                                          <input
                                            type="checkbox"
                                            checked={selectedRealisasiIds.has(realisasi.id)}
                                            onChange={() => handleToggleRealisasiSelection(realisasi.id)}
                                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                          />
                                        </td>
                                      )}
                                      <td className="px-4 py-2 text-gray-700">{formatDate(realisasi.tanggalRealisasi)}</td>
                                      <td className="px-4 py-2 text-right text-blue-700 font-semibold">{formatCurrency(Math.abs(realisasi.amount))}</td>
                                      <td className="px-4 py-2 text-gray-800 font-mono text-xs bg-yellow-50">
                                        <span className="font-semibold">{realisasi.costCenter || '-'}</span>
                                      </td>
                                      <td className="px-4 py-2 text-gray-600 text-xs">
                                        <div className="max-w-[130px] truncate" title={realisasi.headerText || ''}>
                                          {realisasi.headerText || '-'}
                                        </div>
                                      </td>
                                      <td className="px-4 py-2 text-gray-600 text-xs">
                                        <div className="max-w-[130px] truncate" title={realisasi.lineText || ''}>
                                          {realisasi.lineText || '-'}
                                        </div>
                                      </td>
                                      {!realisasiViewOnly && (
                                        <td className="px-4 py-2 text-center">
                                          <div className="flex items-center justify-center gap-2">
                                            <button
                                              onClick={() => {
                                                setEditingRealisasiId(realisasi.id);
                                                setRealisasiForm({
                                                  tanggalRealisasi: realisasi.tanggalRealisasi.split('T')[0],
                                                  amount: Math.abs(realisasi.amount).toString(),
                                                  headerText: realisasi.headerText || '',
                                                  lineText: realisasi.lineText || '',
                                                  keterangan: realisasi.keterangan || '',
                                                  kdAkunBiaya: realisasi.kdAkunBiaya || '',
                                                  costCenter: realisasi.costCenter || '',
                                                });
                                              }}
                                              className="text-blue-600 hover:text-blue-800 transition-colors p-1 hover:bg-blue-50 rounded"
                                              title="Edit"
                                            >
                                              <Edit2 size={16} />
                                            </button>
                                            <button
                                              onClick={() => handleDeleteRealisasi(realisasi.id)}
                                              className="text-red-600 hover:text-red-800 transition-colors p-1 hover:bg-red-50 rounded"
                                              title="Hapus"
                                            >
                                              <Trash2 size={16} />
                                            </button>
                                          </div>
                                        </td>
                                      )}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-white px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => {
                  setShowRealisasiModal(false);
                  setSelectedPeriode(null);
                  setRealisasiViewOnly(false);
                  setRealisasiData([]);
                  setLoadingRealisasiData(false);
                  setEditingRealisasiId(null);
                  setSelectedRealisasiIds(new Set());
                  setRealisasiForm({
                    tanggalRealisasi: new Date().toISOString().split('T')[0],
                    amount: '',
                    headerText: '',
                    lineText: '',
                    keterangan: '',
                    kdAkunBiaya: '',
                    costCenter: '',
                  });
                }}
                className="px-5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Rincian Accrual per Cost Center */}
      {showCostCenterModal && costCenterModalPeriode && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4">
          <div className="bg-white rounded-xl sm:rounded-2xl shadow-2xl max-w-3xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="sticky top-0 bg-gradient-to-r from-amber-500 to-amber-600 px-6 py-5 flex items-center justify-between flex-shrink-0">
              <div>
                <h2 className="text-xl font-bold text-white">Rincian Accrual per Cost Center</h2>
                <p className="text-sm text-amber-100 mt-1">
                  {costCenterModalPeriode.bulan} - Periode {costCenterModalPeriode.periodeKe}
                  {costCenterModalAccrual && (
                    <span className="ml-2">· {costCenterModalAccrual.vendor}</span>
                  )}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowCostCenterModal(false);
                  setCostCenterModalPeriode(null);
                  setCostCenterModalAccrual(null);
                  setCostCenterData([]);
                  setEditingCostCenterId(null);
                  setSelectedCostCenterIds(new Set());
                  setCostCenterForm({ costCenter: '', kdAkunBiaya: '', amount: '', headerText: '', lineText: '', keterangan: '' });
                }}
                className="text-white hover:text-amber-100 transition-colors rounded-full hover:bg-white/10 p-1"
              >
                <X size={24} />
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto p-6 bg-gray-50 flex-1">
              {/* Info Accrual Induk */}
              {costCenterModalAccrual && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                  <p className="text-xs font-semibold text-amber-700 mb-2 uppercase tracking-wide">Data Accrual</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-3">
                    <div>
                      <span className="text-gray-500">Vendor</span>
                      <p className="font-semibold text-gray-800 truncate" title={costCenterModalAccrual.vendor}>{costCenterModalAccrual.vendor}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Kode Akun Biaya</span>
                      <p className="font-semibold text-gray-800">{costCenterModalAccrual.kdAkunBiaya}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Cost Center</span>
                      <p className="font-semibold text-gray-800">{costCenterModalAccrual.costCenter || '-'}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Amount Periode Ini</span>
                      <p className="font-semibold text-amber-700">{formatCurrency(Math.abs(costCenterModalPeriode.amountAccrual))}</p>
                    </div>
                  </div>
                  {costCenterData.length === 0 && (
                    <button
                      type="button"
                      onClick={() => setCostCenterForm({
                        costCenter: costCenterModalAccrual.costCenter || '',
                        kdAkunBiaya: costCenterModalAccrual.kdAkunBiaya || '',
                        amount: Math.abs(costCenterModalPeriode.amountAccrual).toString(),
                        headerText: costCenterModalAccrual.headerText || '',
                        lineText: '',
                        keterangan: '',
                      })}
                      className="text-xs px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors font-medium"
                    >
                      ↓ Isi form dari data accrual ini
                    </button>
                  )}
                </div>
              )}

              {/* Summary */}
              <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
                <div className="grid grid-cols-2 gap-4 text-center">
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Total Amount Accrual</p>
                    <p className="text-lg font-bold text-amber-700">{formatCurrency(Math.abs(costCenterModalPeriode.amountAccrual))}</p>
                    <p className="text-xs text-gray-400 mt-0.5">otomatis dari sum rincian</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Jumlah Rincian</p>
                    <p className="text-lg font-bold text-gray-800">{costCenterData.length} entri</p>
                  </div>
                </div>
              </div>

              {/* Import dari File */}
              <div className="bg-white rounded-lg border border-gray-200 p-5 mb-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Import dari File</h3>
                <div className="flex items-center gap-3">
                  <label className={`flex-1 cursor-pointer ${uploadingCostCenterFile ? 'opacity-60 pointer-events-none' : ''}`}>
                    <div className="flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-all">
                      <Upload size={18} />
                      <span className="text-sm font-medium">
                        {uploadingCostCenterFile ? 'Mengupload...' : 'Upload File (Excel / XML SAP)'}
                      </span>
                    </div>
                    <input
                      type="file"
                      accept=".xlsx,.xls,.xml"
                      onChange={handleCostCenterFileUpload}
                      disabled={uploadingCostCenterFile}
                      className="hidden"
                    />
                  </label>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  Excel: Kolom A = Amount · B = Cost Center · C = Kode Akun Biaya · D = Keterangan
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  XML SAP: kolom J (Amount) · K (Cost Center) · I (Kode Akun Biaya)
                </p>
              </div>

              {/* Form tambah/edit */}
              <form onSubmit={handleCostCenterSubmit} className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">
                  {editingCostCenterId ? 'Edit Rincian' : 'Tambah Rincian'}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Amount <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="number"
                      name="amount"
                      value={costCenterForm.amount}
                      onChange={handleCostCenterInputChange}
                      required
                      min="0"
                      step="0.01"
                      className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent text-sm"
                      placeholder="Masukkan amount"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Cost Center</label>
                    <input
                      type="text"
                      name="costCenter"
                      value={costCenterForm.costCenter}
                      onChange={handleCostCenterInputChange}
                      className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent text-sm"
                      placeholder="Masukkan cost center"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Kode Akun Biaya</label>
                    <input
                      type="text"
                      name="kdAkunBiaya"
                      value={costCenterForm.kdAkunBiaya}
                      onChange={handleCostCenterInputChange}
                      className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent text-sm"
                      placeholder="Masukkan kode akun biaya"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Header Text (bktxt)</label>
                    <input
                      type="text"
                      name="headerText"
                      value={costCenterForm.headerText}
                      onChange={handleCostCenterInputChange}
                      className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent text-sm"
                      placeholder="Document header text"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Line Text (sgtxt)</label>
                    <input
                      type="text"
                      name="lineText"
                      value={costCenterForm.lineText}
                      onChange={handleCostCenterInputChange}
                      className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent text-sm"
                      placeholder="Line text"
                    />
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <button
                    type="submit"
                    disabled={submittingCostCenter}
                    className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submittingCostCenter ? 'Menyimpan...' : editingCostCenterId ? 'Update Rincian' : 'Simpan Rincian'}
                  </button>
                  {editingCostCenterId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCostCenterId(null);
                        setCostCenterForm({ costCenter: '', kdAkunBiaya: '', amount: '', headerText: '', lineText: '', keterangan: '' });
                      }}
                      className="px-5 py-2.5 border border-gray-300 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      Batal
                    </button>
                  )}
                </div>
              </form>

              {/* Daftar rincian */}
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-gray-700">Daftar Rincian</h3>
                    {costCenterData.length > 0 && (
                      <span className="text-xs text-gray-500">({costCenterData.length} data)</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {costCenterData.length > 0 && (
                      <button
                        onClick={handleToggleSelectAllCostCenter}
                        className="text-xs px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-700 rounded transition-colors"
                        title={selectedCostCenterIds.size === costCenterData.length ? 'Batal Pilih Semua' : 'Pilih Semua'}
                      >
                        {selectedCostCenterIds.size === costCenterData.length ? '✓ Semua' : 'Pilih Semua'}
                      </button>
                    )}
                    {selectedCostCenterIds.size > 0 && (
                      <>
                        <span className="text-xs text-gray-600">{selectedCostCenterIds.size} terpilih</span>
                        <button
                          onClick={handleBulkDeleteCostCenter}
                          disabled={deletingBulkCostCenter}
                          className="text-xs px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                        >
                          <Trash2 size={12} />
                          {deletingBulkCostCenter ? 'Menghapus...' : 'Hapus Terpilih'}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {loadingCostCenterData ? (
                  <div className="p-8 text-center">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500"></div>
                    <p className="text-gray-500 text-sm mt-2">Memuat rincian...</p>
                  </div>
                ) : costCenterData.length === 0 ? (
                  <div className="p-6 text-center">
                    <p className="text-sm text-gray-500 mb-3">Belum ada rincian untuk periode ini</p>
                    {costCenterModalPeriode && Math.abs(costCenterModalPeriode.amountAccrual) > 0 && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-700 text-left">
                        <p className="font-semibold mb-1">💡 Form di atas sudah diisi otomatis dari data accrual periode ini ({formatCurrency(Math.abs(costCenterModalPeriode.amountAccrual))}).</p>
                        <p>Scroll ke atas lalu klik <strong>Simpan Rincian</strong> untuk menambahkannya, atau ubah sesuai kebutuhan.</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="overflow-x-auto p-0">
                    {(() => {
                      // Group by kdAkunBiaya
                      const grouped = costCenterData.reduce((acc, entry) => {
                        const key = entry.kdAkunBiaya || '-';
                        if (!acc[key]) acc[key] = [];
                        acc[key].push(entry);
                        return acc;
                      }, {} as Record<string, CostCenterEntry[]>);

                      return Object.entries(grouped).map(([kdAkunBiaya, items]) => {
                        const hasMultiple = items.length > 1;
                        const isExpanded = expandedCostCenterGroups.has(kdAkunBiaya);
                        const totalGroupAmount = items.reduce((sum, item) => sum + item.amount, 0);

                        return (
                          <div key={kdAkunBiaya} className="mb-4 border border-gray-200 rounded-lg overflow-hidden">
                            {/* Group Header */}
                            <div className="bg-gradient-to-r from-amber-50 to-amber-100 px-4 py-3 flex items-center justify-between">
                              <div
                                className={`flex items-center gap-3 flex-1 ${hasMultiple ? 'cursor-pointer' : ''}`}
                                onClick={() => {
                                  if (hasMultiple) {
                                    const newExpanded = new Set(expandedCostCenterGroups);
                                    if (newExpanded.has(kdAkunBiaya)) {
                                      newExpanded.delete(kdAkunBiaya);
                                    } else {
                                      newExpanded.add(kdAkunBiaya);
                                    }
                                    setExpandedCostCenterGroups(newExpanded);
                                  }
                                }}
                              >
                                {hasMultiple && (
                                  <div className="text-amber-600">
                                    {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                  </div>
                                )}
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium text-amber-700">Kode Akun Biaya:</span>
                                    <span className="font-mono font-bold text-sm text-amber-900">{kdAkunBiaya}</span>
                                    <span className="text-xs text-amber-600">({items.length} entri)</span>
                                  </div>
                                  {hasMultiple && (
                                    <div className="text-xs text-amber-600 mt-1">
                                      {items.length} Cost Center berbeda · Total: {formatCurrency(totalGroupAmount)}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                {/* Download Jurnal Button */}
                                {costCenterModalAccrual && (
                                  <div className="relative">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (openCostCenterGroupDropdown?.key === kdAkunBiaya) {
                                          setOpenCostCenterGroupDropdown(null);
                                        } else {
                                          const rect = e.currentTarget.getBoundingClientRect();
                                          setOpenCostCenterGroupDropdown({ key: kdAkunBiaya, items, accrualItem: costCenterModalAccrual!, rect: { top: rect.bottom, right: window.innerWidth - rect.right } });
                                        }
                                      }}
                                      className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded transition-colors flex items-center gap-1 shadow-sm"
                                      title="Download Jurnal SAP untuk semua rincian dalam grup ini"
                                    >
                                      <Download size={14} />
                                      <span className="font-medium">Download Jurnal</span>
                                      <ChevronDown size={12} />
                                    </button>
                                  </div>
                                )}
                                <div className="text-right">
                                  <div className="text-lg font-bold text-amber-900">{formatCurrency(totalGroupAmount)}</div>
                                </div>
                              </div>
                            </div>

                            {/* Detail Table - show if single item OR expanded */}
                            {(!hasMultiple || isExpanded) && (
                              <table className="w-full text-sm">
                                <thead className="bg-gray-50 border-b border-gray-200">
                                  <tr>
                                    <th className="px-3 py-2 text-center text-xs font-semibold text-gray-700 w-10">
                                      <input
                                        type="checkbox"
                                        checked={items.every(item => selectedCostCenterIds.has(item.id))}
                                        onChange={() => {
                                          const allSelected = items.every(item => selectedCostCenterIds.has(item.id));
                                          const newSet = new Set(selectedCostCenterIds);
                                          items.forEach(item => {
                                            if (allSelected) newSet.delete(item.id);
                                            else newSet.add(item.id);
                                          });
                                          setSelectedCostCenterIds(newSet);
                                        }}
                                        className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                                        title="Pilih semua dalam grup ini"
                                      />
                                    </th>
                                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700">Amount</th>
                                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 bg-yellow-50">Cost Center</th>
                                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">Header Text</th>
                                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">Line Text</th>
                                    <th className="px-4 py-2 text-center text-xs font-semibold text-gray-700">Action</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {items.map(entry => (
                                    <tr key={entry.id} className={`hover:bg-amber-50 transition-colors ${selectedCostCenterIds.has(entry.id) ? 'bg-amber-50' : ''}`}>
                                      <td className="px-3 py-2 text-center">
                                        <input
                                          type="checkbox"
                                          checked={selectedCostCenterIds.has(entry.id)}
                                          onChange={() => handleToggleCostCenterSelection(entry.id)}
                                          className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                                        />
                                      </td>
                                      <td className="px-4 py-2 text-right text-amber-700 font-semibold">{formatCurrency(entry.amount)}</td>
                                      <td className="px-4 py-2 text-gray-800 font-mono text-xs bg-yellow-50">
                                        <span className="font-semibold">{entry.costCenter || '-'}</span>
                                      </td>
                                      <td className="px-4 py-2 text-gray-600 text-xs">
                                        <div className="max-w-[130px] truncate" title={entry.headerText || ''}>
                                          {entry.headerText || '-'}
                                        </div>
                                      </td>
                                      <td className="px-4 py-2 text-gray-600 text-xs">
                                        <div className="max-w-[130px] truncate" title={entry.lineText || ''}>
                                          {entry.lineText || '-'}
                                        </div>
                                      </td>
                                      <td className="px-4 py-2 text-center">
                                        <div className="flex items-center justify-center gap-2">
                                          <button
                                            onClick={() => {
                                              setEditingCostCenterId(entry.id);
                                              setCostCenterForm({
                                                costCenter: entry.costCenter || '',
                                                kdAkunBiaya: entry.kdAkunBiaya || '',
                                                amount: entry.amount.toString(),
                                                headerText: entry.headerText || '',
                                                lineText: entry.lineText || '',
                                                keterangan: entry.keterangan || '',
                                              });
                                            }}
                                            className="text-blue-600 hover:text-blue-800 transition-colors p-1 hover:bg-blue-50 rounded"
                                            title="Edit"
                                          >
                                            <Edit2 size={16} />
                                          </button>
                                          <button
                                            onClick={() => handleDeleteCostCenter(entry.id)}
                                            className="text-red-600 hover:text-red-800 transition-colors p-1 hover:bg-red-50 rounded"
                                            title="Hapus"
                                          >
                                            <Trash2 size={16} />
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="bg-white px-6 py-4 border-t border-gray-200 flex justify-end flex-shrink-0">
              <button
                onClick={() => {
                  setShowCostCenterModal(false);
                  setCostCenterModalPeriode(null);
                  setCostCenterModalAccrual(null);
                  setCostCenterData([]);
                  setEditingCostCenterId(null);
                  setSelectedCostCenterIds(new Set());
                  setCostCenterForm({ costCenter: '', kdAkunBiaya: '', amount: '', headerText: '', lineText: '', keterangan: '' });
                }}
                className="px-5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Import Realisasi Global */}
      {showImportGlobalModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4">
          <div className="bg-white rounded-xl sm:rounded-2xl shadow-2xl max-w-2xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-hidden">
            {/* Modal Header */}
            <div className="sticky top-0 bg-gradient-to-r from-red-600 to-red-700 px-6 py-5 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">Import Realisasi Global</h2>
              <button
                onClick={() => setShowImportGlobalModal(false)}
                className="text-white/80 hover:text-white transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 140px)' }}>
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Instruksi Import</h3>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-gray-700">
                  <ul className="list-disc list-inside space-y-2">
                    <li>File Excel harus memiliki format yang sesuai</li>
                    <li><strong>Kolom C (index 2):</strong> Nomor PO/PR</li>
                    <li><strong>Kolom J (index 9):</strong> Amount Realisasi</li>
                    <li>Sistem akan mencocokkan data berdasarkan <strong>Nomor PO</strong></li>
                    <li>Realisasi akan ditambahkan ke periode yang aktif atau periode dengan saldo tersisa</li>
                    <li>Baris dengan PO yang tidak ditemukan akan dilewati dan dilaporkan</li>
                  </ul>
                </div>
              </div>

              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Upload File Excel/XML</h3>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                  <Upload className="mx-auto mb-3 text-gray-400" size={48} />
                  <p className="text-sm text-gray-600 mb-4">
                    Pilih file Excel (.xlsx, .xls) atau XML untuk import realisasi
                  </p>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.xml"
                    onChange={handleGlobalExcelUpload}
                    disabled={uploadingGlobalExcel}
                    className="hidden"
                    id="global-excel-upload"
                  />
                  <label
                    htmlFor="global-excel-upload"
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
                      uploadingGlobalExcel
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-red-600 text-white hover:bg-red-700'
                    }`}
                  >
                    <Upload size={18} />
                    {uploadingGlobalExcel ? 'Mengupload...' : 'Pilih File'}
                  </label>
                </div>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-gray-700">
                <p className="font-semibold mb-2">Perhatian:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Pastikan nomor PO di file sama persis dengan data accrual</li>
                  <li>File XML atau Excel (.xlsx, .xls) dengan format SAP Report</li>
                  <li>Import akan memproses semua baris yang valid</li>
                  <li>Proses import mungkin memakan waktu untuk file besar</li>
                </ul>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="sticky bottom-0 bg-white px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setShowImportGlobalModal(false)}
                disabled={uploadingGlobalExcel}
                className="px-6 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-semibold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading Overlay untuk proses export/import */}
      {(uploadingExcel || uploadingGlobalExcel || uploadingImportExcel || submitting || uploadingCostCenterFile) && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 sm:p-8 shadow-2xl flex flex-col items-center space-y-4 max-w-sm mx-4">
            <div className="animate-spin rounded-full h-12 w-12 sm:h-16 sm:w-16 border-4 border-red-600 border-t-transparent"></div>
            <div className="text-center">
              <p className="text-base sm:text-lg font-semibold text-gray-800">
                {uploadingImportExcel 
                  ? 'Mengimport file Excel...' 
                  : uploadingExcel || uploadingGlobalExcel 
                    ? 'Memproses file...' 
                    : 'Menyimpan data...'}
              </p>
              <p className="text-xs sm:text-sm text-gray-500 mt-1">
                {uploadingImportExcel 
                  ? 'Mohon tunggu, proses mungkin memakan waktu untuk file besar...' 
                  : 'Mohon tunggu sebentar'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Modal Import Excel Accrual */}
      {showImportExcelModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4">
          <div className="bg-white rounded-xl sm:rounded-2xl shadow-2xl max-w-2xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-hidden">
            {/* Modal Header */}
            <div className="sticky top-0 bg-gradient-to-r from-red-600 to-red-700 px-6 py-5 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">Import Data Accrual dari Excel</h2>
              <button
                onClick={() => setShowImportExcelModal(false)}
                disabled={uploadingImportExcel}
                className={`text-white/80 hover:text-white transition-colors ${uploadingImportExcel ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <X size={24} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-140px)]">
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Upload File Excel</h3>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                  <Upload className="mx-auto mb-3 text-gray-400" size={48} />
                  <p className="text-sm text-gray-600 mb-4">
                    Pilih file Excel yang berisi data accrual
                  </p>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleImportExcel}
                    disabled={uploadingImportExcel}
                    className="hidden"
                    id="excel-import-upload"
                  />
                  <label
                    htmlFor="excel-import-upload"
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
                      uploadingImportExcel
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-red-600 text-white hover:bg-red-700'
                    }`}
                  >
                    <Upload size={18} />
                    {uploadingImportExcel ? 'Mengimport...' : 'Pilih File Excel'}
                  </label>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-gray-700">
                <p className="font-semibold mb-2">Format File Excel:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>File berisi beberapa sheet. Sistem memproses <strong>semua sheet yang namanya kode akun accrual</strong> (mis. 21600010, 21600012, 21600018).</li>
                  <li>Di sheet kode akun: kolom PEKERJAAN/KLASIFIKASI, VENDOR, PO/PR, ORDER, KETERANGAN, NILAI PO, <strong>OUTSTANDING/OUSTANDING/SALDO</strong>. <strong>Semua baris</strong> diproses (vendor sama, no PO beda = baris terpisah).</li>
                  <li>Sheet <strong>REKAP</strong>: hanya digunakan untuk kode akun yang <strong>tidak punya sheet sendiri</strong>. Kolom AKUN, KETERANGAN, SALDO AKHIR. Keterangan "BIAYA YMH ..." disesuaikan otomatis ke <strong>klasifikasi</strong> per kode akun.</li>
                  <li>Proses import mungkin memakan waktu untuk file besar dengan banyak baris.</li>
                </ul>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-gray-700">
                <p className="font-semibold mb-2">Perhatian:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Satu baris di Excel REKAP = satu baris di tabel. Nilai amount mengikuti file (tidak dibagi rata). Untuk kode akun dengan detail (mis. 21600001), isi file per baris (Gaji, Cuti Tahunan, dll.) dengan nilai masing-masing.</li>
                  <li>Accrual yang sudah ada (match kode akun + no PO + vendor, atau kode akun + klasifikasi) akan diupdate; lainnya dibuat baru.</li>
                  <li>Pastikan kolom saldo (OUTSTANDING/OUSTANDING/SALDO) ada di sheet kode akun agar data dapat diproses.</li>
                </ul>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="sticky bottom-0 bg-white px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setShowImportExcelModal(false)}
                disabled={uploadingImportExcel}
                className="px-6 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-semibold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Portal dropdown Cost Element Jurnal (agar tidak terclip overflow-hidden modal) */}
      {openCostCenterGroupDropdown && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setOpenCostCenterGroupDropdown(null)} />
          <div
            className="fixed z-[9999] w-48 bg-white border border-gray-200 rounded-lg shadow-xl"
            style={{ top: openCostCenterGroupDropdown.rect.top + 4, right: openCostCenterGroupDropdown.rect.right }}
          >
            <button
              onClick={() => {
                promptJurnalTexts((ht, lt) => handleDownloadJurnalSAPPerRincianGroup(openCostCenterGroupDropdown.items, openCostCenterGroupDropdown.accrualItem, openCostCenterGroupDropdown.key, ht, lt));
                setOpenCostCenterGroupDropdown(null);
              }}
              className="block w-full text-left px-3 py-2.5 text-xs text-gray-700 hover:bg-green-50 transition-colors rounded-t-lg border-b border-gray-100"
            >
              <div className="font-medium">Download Excel</div>
              <div className="text-[10px] text-gray-500">{openCostCenterGroupDropdown.items.length} entri rincian</div>
            </button>
            <button
              onClick={() => {
                promptJurnalTexts((ht, lt) => handleDownloadJurnalSAPPerRincianGroupTxt(openCostCenterGroupDropdown.items, openCostCenterGroupDropdown.accrualItem, openCostCenterGroupDropdown.key, ht, lt));
                setOpenCostCenterGroupDropdown(null);
              }}
              className="block w-full text-left px-3 py-2.5 text-xs text-gray-700 hover:bg-green-50 transition-colors rounded-b-lg"
            >
              <div className="font-medium">Download TXT</div>
              <div className="text-[10px] text-gray-500">{openCostCenterGroupDropdown.items.length} entri rincian</div>
            </button>
          </div>
        </>
      )}
      {openGroupDropdown && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setOpenGroupDropdown(null)} />
          <div
            className="fixed z-[9999] w-44 bg-white border border-gray-200 rounded-lg shadow-xl"
            style={{ top: openGroupDropdown.rect.top + 4, right: openGroupDropdown.rect.right }}
          >
            <button
              onClick={() => {
                promptJurnalTexts((ht, lt) => handleDownloadJurnalSAPPerCostElementGroup(openGroupDropdown.items, openGroupDropdown.accrualItem, openGroupDropdown.key, ht, lt));
                setOpenGroupDropdown(null);
              }}
              className="block w-full text-left px-3 py-2.5 text-xs text-gray-700 hover:bg-green-50 transition-colors rounded-t-lg border-b border-gray-100"
            >
              <div className="font-medium">Download Excel</div>
              <div className="text-[10px] text-gray-500">{openGroupDropdown.items.length} transaksi</div>
            </button>
            <button
              onClick={() => {
                promptJurnalTexts((ht, lt) => handleDownloadJurnalSAPPerCostElementGroupTxt(openGroupDropdown.items, openGroupDropdown.accrualItem, openGroupDropdown.key, ht, lt));
                setOpenGroupDropdown(null);
              }}
              className="block w-full text-left px-3 py-2.5 text-xs text-gray-700 hover:bg-green-50 transition-colors rounded-b-lg"
            >
              <div className="font-medium">Download TXT</div>
              <div className="text-[10px] text-gray-500">{openGroupDropdown.items.length} transaksi</div>
            </button>
          </div>
        </>
      )}
      {/* Modal Header Text dan Line Text untuk Jurnal Realisasi */}
      {showJurnalHeaderModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="px-6 py-4 bg-gradient-to-r from-green-600 to-green-700 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">Teks Jurnal Realisasi</h2>
                <p className="text-green-100 text-xs mt-0.5">Isi Header Text dan Line Text untuk kolom SAP</p>
              </div>
              <button onClick={() => setShowJurnalHeaderModal(false)} className="text-white hover:text-green-100 rounded-full hover:bg-white/10 p-1"><X size={22} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  Header Text <span className="text-gray-400 font-normal">(bktxt – kolom 8)</span>
                </label>
                <input
                  type="text"
                  value={jurnalHeaderInput}
                  onChange={(e) => setJurnalHeaderInput(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="Masukkan header text..."
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  Line Text <span className="text-gray-400 font-normal">(sgtxt – kolom 12)</span>
                </label>
                <input
                  type="text"
                  value={jurnalLineInput}
                  onChange={(e) => setJurnalLineInput(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="Masukkan line text..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setShowJurnalHeaderModal(false);
                      jurnalPendingCallback?.(jurnalHeaderInput, jurnalLineInput);
                    }
                  }}
                />
              </div>
            </div>
            <div className="px-6 pb-6 flex justify-end gap-3">
              <button
                onClick={() => setShowJurnalHeaderModal(false)}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
              >Batal</button>
              <button
                onClick={() => {
                  setShowJurnalHeaderModal(false);
                  jurnalPendingCallback?.(jurnalHeaderInput, jurnalLineInput);
                }}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
              >Download</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
