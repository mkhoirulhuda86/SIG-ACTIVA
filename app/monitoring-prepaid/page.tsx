'use client';

import { toast } from 'sonner';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { gsap } from 'gsap';
import { Search, Download, Plus, Edit, Trash2, ChevronDown, ChevronUp, CheckCircle, Clock, Upload, FileSpreadsheet, RefreshCw } from 'lucide-react';
import dynamic from 'next/dynamic';
import { exportToCSV } from '../utils/exportUtils';
import { useRealtimeUpdates } from '@/hooks/useRealtimeUpdates';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';

// Lazy load components
const Sidebar = dynamic(() => import('../components/Sidebar'), { ssr: false });
const Header = dynamic(() => import('../components/Header'), { ssr: false });
const PrepaidForm = dynamic(() => import('../components/PrepaidForm'), { ssr: false });

// Lazy load ExcelJS on demand
let ExcelJS: any = null;
const loadExcelJS = async () => {
  if (!ExcelJS) {
    ExcelJS = (await import('exceljs')).default;
  }
  return ExcelJS;
};

// -- Module-level constants (not recreated on every render) --------------
const BULAN_MAP: Record<string, number> = {
  'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'Mei': 4, 'Jun': 5,
  'Jul': 6, 'Agu': 7, 'Sep': 8, 'Okt': 9, 'Nov': 10, 'Des': 11,
};
const formatCurrency = (amount: number) =>
  `Rp ${Math.round(amount).toLocaleString('id-ID')}`;

interface PrepaidPeriode {
  id: number;
  periodeKe: number;
  bulan: string;
  tahun: number;
  amountPrepaid: number;
  isAmortized: boolean;
  amortizedDate?: Date;
}

interface Prepaid {
  id: number;
  companyCode?: string;
  noPo?: string;
  alokasi: string;
  kdAkr: string;
  namaAkun: string;
  deskripsi?: string;
  klasifikasi?: string;
  totalAmount: number;
  startDate: string;
  period: number;
  periodUnit: string;
  remaining: number;
  totalAmortisasi: number;
  pembagianType: string;
  vendor: string;
  type: string;
  headerText?: string;
  costCenter?: string;
  // periodes now lazy-loaded on expand ? stored in periodesCache
}

export default function MonitoringPrepaidPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [prepaidData, setPrepaidData] = useState<Prepaid[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editMode, setEditMode] = useState<'create' | 'edit'>('create');
  const [editData, setEditData] = useState<Prepaid | null>(null);
  const [userRole, setUserRole] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [periodesCache, setPeriodesCache] = useState<Record<number, PrepaidPeriode[]>>({});
  const [periodesLoading, setPeriodesLoading] = useState<Set<number>>(new Set());
  const [editingPeriode, setEditingPeriode] = useState<{ prepaidId: number; periodeId: number; amount: string } | null>(null);
  const [savingPeriode, setSavingPeriode] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);

  // Animation refs
  const pageRef       = useRef<HTMLDivElement>(null);
  const metricRef     = useRef<HTMLDivElement>(null);
  const filterBarRef  = useRef<HTMLDivElement>(null);
  const tableCardRef  = useRef<HTMLDivElement>(null);
  const tableBodyRef  = useRef<HTMLTableSectionElement>(null);
  const addBtnRef     = useRef<HTMLButtonElement>(null);

  // -- Lazy-load periodes on row expand (cached) ------------------------------
  const toggleRow = useCallback(async (id: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    // Only fetch if not yet cached
    if (!periodesCache[id]) {
      setPeriodesLoading(prev => { const n = new Set(prev); n.add(id); return n; });
      try {
        const res = await fetch(`/api/prepaid?id=${id}&periodes=1`);
        const data: PrepaidPeriode[] = await res.json();
        setPeriodesCache(prev => ({ ...prev, [id]: data }));
      } finally {
        setPeriodesLoading(prev => { const n = new Set(prev); n.delete(id); return n; });
      }
    }
  }, [periodesCache]);

  const handleSavePeriodeAmount = async (periodeId: number, amount: number, prepaidId: number) => {
    setSavingPeriode(true);
    try {
      const res = await fetch('/api/prepaid/periode', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodeId, amountPrepaid: amount })
      });
      if (res.ok) {
        // Refresh only this item's periodes (targeted update, no full refetch)
        const res2 = await fetch(`/api/prepaid?id=${prepaidId}&periodes=1`);
        const periodes: PrepaidPeriode[] = await res2.json();
        setPeriodesCache(prev => ({ ...prev, [prepaidId]: periodes }));
        // Lightweight full-list refresh to update Saldo / metrics
        fetchPrepaidData();
        setEditingPeriode(null);
      } else {
        toast.error('Gagal menyimpan amortisasi');
      }
    } finally {
      setSavingPeriode(false);
    }
  };

  // Load user role from localStorage
  useEffect(() => {
    const role = localStorage.getItem('userRole') || '';
    setUserRole(role);
  }, []);

  // Check if user can edit (only ADMIN_SYSTEM and STAFF_ACCOUNTING)
  const canEdit = userRole === 'ADMIN_SYSTEM' || userRole === 'STAFF_ACCOUNTING';

  // Fetch data dari API
  useEffect(() => {
    fetchPrepaidData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchPrepaidData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/prepaid');
      if (response.ok) {
        const data = await response.json();
        setPrepaidData(data);
      } else {
        console.error('Failed to fetch prepaid data');
      }
    } catch (error) {
      console.error('Error fetching prepaid data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Realtime: refresh when another user adds/updates/deletes prepaid
  useRealtimeUpdates(['prepaid'], () => { fetchPrepaidData(); });

  // ─── Page entrance animation (runs once data finishes loading) ──────────────
  useEffect(() => {
    if (loading) return;
    const cards = [metricRef.current, filterBarRef.current, tableCardRef.current].filter(Boolean);
    if (pageRef.current) {
      gsap.fromTo(pageRef.current,
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }
      );
    }
    gsap.fromTo(cards,
      { opacity: 0, y: 36, scale: 0.97 },
      { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'power3.out', stagger: 0.09, delay: 0.1 }
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // ─── Animate table rows when filtered data changes ───────────────────────────
  useEffect(() => {
    if (!tableBodyRef.current) return;
    const rows = tableBodyRef.current.querySelectorAll('tr.data-row');
    if (!rows.length) return;
    gsap.fromTo(rows,
      { opacity: 0, x: -12 },
      { opacity: 1, x: 0, duration: 0.26, ease: 'expo.out', stagger: rows.length > 30 ? 0 : 0.018 }
    );
  }, [prepaidData, debouncedSearch]);

  // ─── Metric number counter animation ────────────────────────────────────────
  useEffect(() => {
    if (loading || !metricRef.current) return;
    const els = metricRef.current.querySelectorAll('[data-metric]');
    gsap.fromTo(els,
      { opacity: 0, y: 20, scale: 0.9 },
      { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: 'back.out(1.5)', stagger: 0.1, delay: 0.15 }
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);


  // --- Debounce search input (300 ms) -------------------------------------
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  // --- Memoized derived data ----------------------------------------------
  const { totalPrepaidValue, totalRemaining, activeItems } = useMemo(() => ({
    totalPrepaidValue: prepaidData.reduce((s, i) => s + i.totalAmount, 0),
    totalRemaining:    prepaidData.reduce((s, i) => s + i.remaining, 0),
    activeItems:       prepaidData.length,
  }), [prepaidData]);

  const filteredData = useMemo(() =>
    prepaidData.filter(item =>
      debouncedSearch === '' ||
      item.kdAkr.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
      item.namaAkun.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
      item.vendor.toLowerCase().includes(debouncedSearch.toLowerCase())
    ),
  [prepaidData, debouncedSearch]);

  const handleDownloadGlobalReport = async () => {
    try {
      const ExcelJSLib = await loadExcelJS();
      const workbook = new ExcelJSLib.Workbook();
      const worksheet = workbook.addWorksheet('Laporan Prepaid');
    
    // Title
    worksheet.mergeCells('A1:N1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'LAPORAN PREPAID';
    titleCell.font = { name: 'Calibri', size: 14, bold: true };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF404040' }
    };
    titleCell.font = { ...titleCell.font, color: { argb: 'FFFFFFFF' } };
    
    // Headers
    worksheet.getRow(2).height = 30;
    const headers = [
      'Company Code',
      'No PO',
      'Assignment/Order',
      'Kode Akun Prepaid',
      'Kode Akun Biaya',
      'Deskripsi',
      'Klasifikasi',
      'Amount',
      'Start Date',
      'Finish Date',
      'Periode',
      'Total Prepaid',
      'Total Amortisasi',
      'Saldo'
    ];
    
    worksheet.getRow(2).values = headers;
    worksheet.getRow(2).eachCell((cell: any) => {
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
      { width: 12 },  // Company Code
      { width: 15 },  // No PO
      { width: 18 },  // Assignment/Order
      { width: 16 },  // Kode Akun Prepaid
      { width: 16 },  // Kode Akun Biaya
      { width: 35 },  // Deskripsi
      { width: 15 },  // Klasifikasi
      { width: 15 },  // Amount
      { width: 12 },  // Start Date
      { width: 12 },  // Finish Date
      { width: 10 },  // Periode
      { width: 15 },  // Total Prepaid
      { width: 15 },  // Total Amortisasi
      { width: 15 }   // Saldo
    ];
    
    let currentRow = 3;
    
    // Data rows
    filteredData.forEach((item) => {
      // Use pre-computed values from API
      const totalAmortized = item.totalAmortisasi ?? (item.totalAmount - item.remaining);
      const saldo = item.totalAmount - totalAmortized;
      
      const row = worksheet.getRow(currentRow);
      
      // Start Date
      const startDate = new Date(item.startDate);
      const startDateStr = `${startDate.getDate().toString().padStart(2, '0')}/${(startDate.getMonth() + 1).toString().padStart(2, '0')}/${startDate.getFullYear()}`;
      
      // Finish Date: periode 1 = bulan start, finish = start + (period-1) bulan
      const finishDate = new Date(item.startDate);
      finishDate.setMonth(finishDate.getMonth() + item.period - 1);
      const finishDateStr = `${finishDate.getDate().toString().padStart(2, '0')}/${(finishDate.getMonth() + 1).toString().padStart(2, '0')}/${finishDate.getFullYear()}`;
      
      row.getCell(1).value = item.companyCode || '';
      row.getCell(2).value = item.noPo || '';
      row.getCell(3).value = item.alokasi || '';
      row.getCell(4).value = item.kdAkr;
      row.getCell(5).value = item.namaAkun;
      row.getCell(6).value = item.deskripsi || '';
      row.getCell(7).value = item.klasifikasi || '';
      row.getCell(8).value = item.totalAmount;
      row.getCell(8).numFmt = '#,##0.0';
      row.getCell(9).value = startDateStr;
      row.getCell(10).value = finishDateStr;
      row.getCell(11).value = `${item.period} ${item.periodUnit}`;
      row.getCell(12).value = item.totalAmount;
      row.getCell(12).numFmt = '#,##0.0';
      row.getCell(13).value = totalAmortized;
      row.getCell(13).numFmt = '#,##0.0';
      row.getCell(14).value = saldo;
      row.getCell(14).numFmt = '#,##0.0';
      
      // Apply borders and styling
      for (let col = 1; col <= 14; col++) {
        const cell = row.getCell(col);
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        
        if (col === 8 || col === 12 || col === 13 || col === 14) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        }
      }
      
      currentRow++;
    });
    
    // Generate and download file
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { 
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Laporan_Prepaid_${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error generating report:', error);
      toast.error('Gagal membuat laporan. Silakan coba lagi.');
    }
  };

  const handleDownloadJurnalSAPPeriode = async (item: Prepaid, periode: PrepaidPeriode, amount: number) => {
    if (!amount || amount <= 0) return;
    try {
      const ExcelJSLib = await loadExcelJS();
      const workbook = new ExcelJSLib.Workbook();
      const worksheet = workbook.addWorksheet('Jurnal SAP');

      const yellowColumns = [7, 9, 13, 16, 17, 18];
      const headers1 = ['xblnr','bukrs','blart','bldat','budat','waers','kursf','bktxt','zuonr','hkont','wrbtr','sgtxt','prctr','kostl','','nplnr','aufnr','valut','flag'];
      const headers2 = ['Reference','company','doc type','doc date','posting date','currency','kurs','header text','Vendor/cu:','account','amount','line text','profit center','cost center','','Network','order numi','value date',''];

      worksheet.getRow(1).height = 15;
      worksheet.getRow(1).values = headers1;
      worksheet.getRow(1).eachCell((cell: any, colNumber: any) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: yellowColumns.includes(colNumber) ? 'FFFFFF00' : 'FFFFE699' } };
        cell.font = { name: 'Calibri', size: 11, bold: true };
        cell.alignment = { horizontal: 'center', vertical: 'bottom' };
      });
      worksheet.getRow(2).height = 15;
      worksheet.getRow(2).values = headers2;
      worksheet.getRow(2).eachCell((cell: any, colNumber: any) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: yellowColumns.includes(colNumber) ? 'FFFFFF00' : 'FFFFE699' } };
        cell.font = { name: 'Calibri', size: 11, bold: true };
        cell.alignment = { horizontal: 'center', vertical: 'bottom' };
      });
      worksheet.columns = [
        { width: 12 },{ width: 10 },{ width: 9 },{ width: 9 },{ width: 12 },{ width: 10 },
        { width: 8 },{ width: 30 },{ width: 12 },{ width: 12 },{ width: 15 },{ width: 30 },
        { width: 12 },{ width: 12 },{ width: 3 },{ width: 10 },{ width: 12 },{ width: 12 },{ width: 5 }
      ];

      // Derive posting date from period month
      const parts = periode.bulan.split(' ');
      const pm = BULAN_MAP[parts[0]] ?? 0;
      const py = parseInt(parts[1]);
      const lastDay = new Date(py, pm + 1, 0).getDate();
      const docDate = `${py}${String(pm + 1).padStart(2, '0')}${String(lastDay).padStart(2, '0')}`;

      const applyRowStyle = (row: any) => {
        for (let col = 1; col <= 19; col++) {
          const cell = row.getCell(col);
          cell.font = { name: 'Aptos Narrow', size: 12 };
          cell.alignment = { horizontal: col === 11 ? 'right' : 'left', vertical: 'bottom' };
        }
      };

      // Entry 1: DEBIT – Kode Akun Biaya (positive)
      const row1 = worksheet.getRow(3);
      row1.height = 15;
      row1.getCell(1).value = '';
      row1.getCell(2).value = item.companyCode || '';
      row1.getCell(3).value = 'SA';
      row1.getCell(4).value = docDate;
      row1.getCell(5).value = docDate;
      row1.getCell(6).value = 'IDR';
      row1.getCell(7).value = '';
      row1.getCell(8).value = item.headerText || '';
      row1.getCell(9).value = '';
      row1.getCell(10).value = item.namaAkun;
      row1.getCell(11).value = amount;
      row1.getCell(11).numFmt = '0';
      row1.getCell(12).value = item.headerText || '';
      row1.getCell(13).value = '';
      row1.getCell(14).value = '';
      row1.getCell(15).value = '';
      row1.getCell(16).value = '';
      row1.getCell(17).value = '';
      row1.getCell(18).value = '';
      row1.getCell(19).value = 'G';
      applyRowStyle(row1);

      // Entry 2: KREDIT – Kode Akun Prepaid (negative)
      const row2 = worksheet.getRow(4);
      row2.height = 15;
      row2.getCell(1).value = '';
      row2.getCell(2).value = item.companyCode || '';
      row2.getCell(3).value = 'SA';
      row2.getCell(4).value = docDate;
      row2.getCell(5).value = docDate;
      row2.getCell(6).value = 'IDR';
      row2.getCell(7).value = '';
      row2.getCell(8).value = item.headerText || '';
      row2.getCell(9).value = '';
      row2.getCell(10).value = item.kdAkr;
      row2.getCell(11).value = -amount;
      row2.getCell(11).numFmt = '0';
      row2.getCell(12).value = item.headerText || '';
      row2.getCell(13).value = '';
      row2.getCell(14).value = item.alokasi || '';
      row2.getCell(15).value = '';
      row2.getCell(16).value = '';
      row2.getCell(17).value = '';
      row2.getCell(18).value = '';
      row2.getCell(19).value = 'G';
      applyRowStyle(row2);

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Jurnal_SAP_${item.kdAkr}_${periode.bulan.replace(' ', '_')}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error generating Jurnal SAP per periodo:', error);
      toast.error('Gagal membuat jurnal SAP. Silakan coba lagi.');
    }
  };

  const handleDownloadJurnalSAPTxtPeriode = (item: Prepaid, periode: PrepaidPeriode, amount: number) => {
    if (!amount || amount <= 0) return;
    const parts = periode.bulan.split(' ');
    const pm = BULAN_MAP[parts[0]] ?? 0;
    const py = parseInt(parts[1]);
    const lastDay = new Date(py, pm + 1, 0).getDate();
    const docDate = `${py}${String(pm + 1).padStart(2, '0')}${String(lastDay).padStart(2, '0')}`;

    const rows: string[][] = [
      // Entry 1: DEBIT – Kode Akun Biaya (positive)
      ['', item.companyCode || '', 'SA', docDate, docDate, 'IDR', '', item.headerText || '', '',
        item.namaAkun, amount.toString(), item.headerText || '', '', '', '', '', '', '', 'G'],
      // Entry 2: KREDIT – Kode Akun Prepaid (negative)
      ['', item.companyCode || '', 'SA', docDate, docDate, 'IDR', '', item.headerText || '', '',
        item.kdAkr, (-amount).toString(), item.headerText || '', '', item.alokasi || '', '', '', '', '', 'G'],
    ];

    const txtContent = rows.map(row => row.join('\t')).join('\n');
    const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Jurnal_SAP_${item.kdAkr}_${periode.bulan.replace(' ', '_')}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/prepaid/import', { method: 'POST', body: formData });
      const result = await res.json();
      if (res.ok) {
        const warningsMsg = result.warnings?.length
          ? `\n\nPeringatan (${result.warnings.length}):\n${result.warnings.slice(0, 10).join('\n')}`
          : '';
        const skippedMsg = result.skipped > 0 
          ? `\n${result.skipped} baris gagal diimport (error)`
          : '';
        toast.success('Import berhasil!', { description: `${result.created} data berhasil diimport${skippedMsg}${warningsMsg}` });
        await fetchPrepaidData();
      } else {
        toast.error(`Gagal mengimpor: ${result.error}`);
      }
    } catch (err) {
      toast.error('Terjadi kesalahan saat mengimpor file');
    } finally {
      setImportLoading(false);
      if (importFileRef.current) importFileRef.current.value = '';
    }
  };

  const handleExport = () => {
    const headers = ['kdAkr', 'namaAkun', 'alokasi', 'vendor', 'totalAmount', 'remaining', 'period', 'type'];
    exportToCSV(filteredData, 'Monitoring_Prepaid.csv', headers);
  };

  const handleDeleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Yakin hapus ${selectedIds.size} data prepaid terpilih?`)) return;

    setDeletingSelected(true);
    try {
      const ids = Array.from(selectedIds).join(',');
      const response = await fetch(`/api/prepaid?ids=${ids}`, { method: 'DELETE' });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Gagal menghapus');
      }
      const data = await response.json();
      setSelectedIds(new Set());
      fetchPrepaidData();
      toast.success(data.count != null ? `${data.count} data berhasil dihapus.` : 'Data berhasil dihapus.');
    } catch (error) {
      console.error('Error bulk delete:', error);
      toast.error('Gagal menghapus data terpilih');
    } finally {
      setDeletingSelected(false);
    }
  }, [selectedIds]);

  const handleEdit = (item: Prepaid) => {
    setEditData(item);
    setEditMode('edit');
    setIsFormOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Apakah Anda yakin ingin menghapus data prepaid ini?')) {
      return;
    }

    try {
      const response = await fetch(`/api/prepaid?id=${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        toast.success('Data prepaid berhasil dihapus!');
        fetchPrepaidData();
      } else {
        toast.error('Gagal menghapus data prepaid');
      }
    } catch (error) {
      console.error('Error deleting prepaid:', error);
      toast.error('Terjadi kesalahan saat menghapus data');
    }
  };

  const handleExportSingle = (item: Prepaid) => {
    const headers = ['companyCode', 'noPo', 'alokasi', 'kdAkr', 'namaAkun', 'deskripsi', 'klasifikasi', 'totalAmount', 'startDate', 'period', 'remaining'];
    exportToCSV([item], `Prepaid_${item.kdAkr}.csv`, headers);
  };

  const handleAddNew = () => {
    setEditData(null);
    setEditMode('create');
    setIsFormOpen(true);
  };

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-slate-50 to-red-50/20">
      {/* Mobile Sidebar Overlay */}
      {isMobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ease-in-out ${
        isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      }`}>
        <Sidebar onClose={() => setIsMobileSidebarOpen(false)} />
      </div>

      {/* Main Content */}
      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen overflow-hidden">
        <Header
          title="Monitoring Prepaid"
          onMenuClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
          subtitle="Monitoring dan input data prepaid dengan laporan SAP"
        />

        {/* ── Loading Skeleton ─────────────────────────────────────── */}
        {loading ? (
          <div className="flex-1 p-4 sm:p-6">
            {/* Metric skeletons */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-2">
                  <Skeleton className="h-3 w-32 rounded" />
                  <Skeleton className="h-7 w-44 rounded" />
                  <Skeleton className="h-2.5 w-24 rounded" />
                </div>
              ))}
            </div>
            {/* Filter bar skeleton */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-5">
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-9 flex-1 min-w-[180px] rounded-lg" />
                <Skeleton className="h-9 w-28 rounded-lg" />
                <Skeleton className="h-9 w-28 rounded-lg" />
                <Skeleton className="h-9 w-28 rounded-lg" />
                <Skeleton className="h-9 w-32 rounded-lg" />
              </div>
            </div>
            {/* Table skeleton */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-slate-50">
                <Skeleton className="h-3 w-36 rounded" />
              </div>
              <div className="p-3 space-y-2">
                {[...Array(7)].map((_, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <Skeleton className="h-4 w-4 rounded" />
                    <Skeleton className="h-4 w-12 rounded" />
                    <Skeleton className="h-4 w-16 rounded" />
                    <Skeleton className="h-4 flex-1 rounded" />
                    <Skeleton className="h-4 w-20 rounded" />
                    <Skeleton className="h-4 w-20 rounded" />
                    <Skeleton className="h-4 w-16 rounded" />
                  </div>
                ))}
              </div>
            </div>
            {/* Centered loading overlay */}
            <div className="fixed inset-0 pointer-events-none flex items-center justify-center z-10">
              <div className="bg-white/90 backdrop-blur-sm border border-red-200/60 rounded-2xl shadow-2xl px-8 py-6 flex flex-col items-center gap-3">
                <div className="relative w-14 h-14">
                  <div className="absolute inset-0 rounded-full border-4 border-red-100" />
                  <div className="absolute inset-0 rounded-full border-4 border-t-red-600 border-r-red-300 border-b-transparent border-l-transparent animate-spin" />
                  <FileSpreadsheet className="absolute inset-0 m-auto w-6 h-6 text-red-600" />
                </div>
                <p className="text-slate-700 text-sm font-semibold tracking-wide">Memuat data prepaid...</p>
                <div className="flex gap-1.5">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="w-2 h-2 rounded-full bg-red-500 animate-bounce"
                      style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div ref={pageRef} className="flex-1 p-4 sm:p-6" style={{ opacity: 0 }}>

            {/* ── Metric Cards ─────────────────────────────────────── */}
            <div ref={metricRef} className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
              {[
                { label: 'Total Prepaid Value', value: formatCurrency(totalPrepaidValue), dot: 'bg-red-500', sub: 'Seluruh nilai prepaid aktif' },
                { label: 'Remaining Amount',    value: formatCurrency(totalRemaining),    dot: 'bg-amber-500', sub: 'Saldo belum diamortisasi' },
                { label: 'Active Items',         value: String(activeItems),               dot: 'bg-green-500', sub: 'Entri prepaid aktif' },
              ].map((m, i) => (
                <div key={i} data-metric
                  className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 hover:shadow-md transition-all duration-200 group cursor-default"
                  style={{ opacity: 0 }}
                  onMouseEnter={e => gsap.to(e.currentTarget, { y: -3, duration: 0.2, ease: 'power2.out' })}
                  onMouseLeave={e => gsap.to(e.currentTarget, { y: 0, duration: 0.2, ease: 'power2.out' })}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-2.5 h-2.5 rounded-full ${m.dot} transition-transform duration-200 group-hover:scale-125`} />
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{m.label}</p>
                  </div>
                  <h3 className="text-xl font-bold text-slate-800 mt-1 font-mono">{m.value}</h3>
                  <p className="text-[10px] text-slate-400 mt-0.5">{m.sub}</p>
                </div>
              ))}
            </div>

            {/* ── Filter / Action Bar ───────────────────────────────── */}
            <div ref={filterBarRef} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-5" style={{ opacity: 0 }}>
              <div className="flex flex-wrap items-center gap-2">
                {/* Search */}
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                  <input
                    type="text"
                    placeholder="Cari akun, nama, vendor..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent text-xs transition-all"
                  />
                </div>

                {/* Hidden file input */}
                <input ref={importFileRef} type="file" accept=".xlsx,.xls,.xlsb" className="hidden" onChange={handleImportExcel} />

                {/* Buttons */}
                <div className="flex flex-wrap gap-2 ml-auto">
                  {[
                    { label: importLoading ? 'Mengimpor...' : 'Import Excel', icon: <Upload size={13}/>, onClick: () => importFileRef.current?.click(), color: '#dc2626', disabled: importLoading },
                    { label: 'Laporan Prepaid', icon: <Download size={13}/>, onClick: handleDownloadGlobalReport, color: '#dc2626' },
                  ].map((btn, i) => (
                    <button key={i}
                      onClick={btn.onClick}
                      disabled={(btn as any).disabled}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-semibold transition-all duration-200 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
                      style={{ backgroundColor: btn.color, color: 'white' }}
                      onMouseEnter={e => gsap.to(e.currentTarget, { scale: 1.05, duration: 0.15, ease: 'power2.out' })}
                      onMouseLeave={e => gsap.to(e.currentTarget, { scale: 1, duration: 0.15, ease: 'power2.out' })}
                    >
                      {btn.icon}
                      <span className="hidden sm:inline">{btn.label}</span>
                    </button>
                  ))}

                  {canEdit && selectedIds.size > 0 && (
                    <button
                      onClick={handleDeleteSelected}
                      disabled={deletingSelected}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-semibold transition-all duration-200 active:scale-95 disabled:opacity-60"
                      style={{ backgroundColor: '#b91c1c', color: 'white' }}
                      onMouseEnter={e => gsap.to(e.currentTarget, { scale: 1.05, duration: 0.15 })}
                      onMouseLeave={e => gsap.to(e.currentTarget, { scale: 1, duration: 0.15 })}
                    >
                      <Trash2 size={13} />
                      <span>{deletingSelected ? 'Menghapus...' : `Hapus (${selectedIds.size})`}</span>
                    </button>
                  )}

                  {canEdit && (
                    <button
                      ref={addBtnRef}
                      onClick={() => {
                        if (addBtnRef.current) gsap.fromTo(addBtnRef.current, { scale: 0.88 }, { scale: 1, duration: 0.35, ease: 'back.out(2.5)' });
                        handleAddNew();
                      }}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-semibold transition-all duration-200 active:scale-95"
                      style={{ backgroundColor: '#dc2626', color: 'white' }}
                      onMouseEnter={e => gsap.to(e.currentTarget, { scale: 1.05, duration: 0.15 })}
                      onMouseLeave={e => gsap.to(e.currentTarget, { scale: 1, duration: 0.15 })}
                    >
                      <Plus size={13} />
                      <span className="hidden sm:inline">Tambah Prepaid</span>
                      <span className="sm:hidden">Tambah</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* ── Data Table ────────────────────────────────────────── */}
            <div ref={tableCardRef} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden transition-shadow hover:shadow-md" style={{ opacity: 0 }}>
              <style jsx>{`
                .custom-scrollbar::-webkit-scrollbar { height: 8px; width: 8px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
                .expand-detail { animation: expandIn 0.28s cubic-bezier(0.34,1.56,0.64,1); }
                @keyframes expandIn {
                  from { opacity: 0; transform: translateY(-10px) scaleY(0.92); }
                  to   { opacity: 1; transform: translateY(0) scaleY(1); }
                }
              `}</style>

              {/* Table top bar */}
              <div className="px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-slate-50 to-red-50/30 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5">
                    <FileSpreadsheet size={11} className="text-red-500" />
                    <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">DATA PREPAID</p>
                  </div>
                  <p className="text-[9px] text-slate-400 mt-0.5">{filteredData.length.toLocaleString('id-ID')} entri ditemukan</p>
                </div>
                {filteredData.length > 0 && (
                  <Badge variant="outline" className="text-[9px] text-slate-500 font-mono">{filteredData.length}</Badge>
                )}
              </div>

              <div className="overflow-x-auto overflow-y-auto max-w-full custom-scrollbar" style={{ maxHeight: 'calc(100vh - 380px)' }}>
                <table className="w-full text-sm min-w-max" style={{ borderCollapse: 'collapse' }}>
                  <thead style={{ background: 'linear-gradient(90deg,#7f1d1d,#dc2626)', position: 'sticky', top: 0, zIndex: 10 }}>
                    <tr>
                      <th className="px-3 py-3 text-center w-10">
                        <input
                          type="checkbox"
                          className="w-3.5 h-3.5 rounded cursor-pointer accent-white"
                          checked={filteredData.length > 0 && filteredData.every(item => selectedIds.has(item.id))}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedIds(new Set(filteredData.map(item => item.id)));
                            else setSelectedIds(new Set());
                          }}
                        />
                      </th>
                      {[
                        'Company', 'No PO', 'Assignment/Order',
                        'Kd Akun Prepaid', 'Kd Akun Biaya', 'Deskripsi', 'Header Text', 'Klasifikasi',
                        'Amount', 'Start', 'Finish', 'Periode',
                        'Total Prepaid', 'Total Amortisasi', 'Saldo', 'Aksi'
                      ].map(h => (
                        <th key={h} className="px-3 py-3 whitespace-nowrap"
                          style={{
                            textAlign: ['Amount','Total Prepaid','Total Amortisasi','Saldo'].includes(h) ? 'right'
                              : ['Aksi','Start','Finish','Periode'].includes(h) ? 'center' : 'left',
                            color: '#fecaca', fontSize: 9, fontWeight: 600,
                            textTransform: 'uppercase', letterSpacing: 0.5,
                          }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody ref={tableBodyRef} className="divide-y divide-gray-100">
                    {filteredData.map((item, idx) => {
                      const startDate = new Date(item.startDate);
                      const finishDate = new Date(startDate);
                      finishDate.setMonth(finishDate.getMonth() + item.period - 1);
                      const totalAmortisasi = item.totalAmortisasi ?? (item.totalAmount - item.remaining);
                      const saldo = item.totalAmount - totalAmortisasi;
                      const isExpanded = expandedRows.has(item.id);
                      const periodes = periodesCache[item.id] ?? [];
                      const isPeriodeLoading = periodesLoading.has(item.id);
                      const today = new Date();
                      const todayFirst = new Date(today.getFullYear(), today.getMonth(), 1);

                      return (
                        <React.Fragment key={item.id}>
                          <tr className={`data-row transition-colors duration-100 ${idx % 2 === 0 ? 'bg-white hover:bg-red-50/20' : 'bg-slate-50/50 hover:bg-red-50/30'}`}>
                            <td className="px-3 py-2.5 text-center">
                              <input type="checkbox" className="w-3.5 h-3.5 rounded cursor-pointer accent-red-600"
                                checked={selectedIds.has(item.id)}
                                onChange={(e) => {
                                  setSelectedIds(prev => {
                                    const n = new Set(prev);
                                    e.target.checked ? n.add(item.id) : n.delete(item.id);
                                    return n;
                                  });
                                }} />
                            </td>
                            <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap text-xs">{item.companyCode || '-'}</td>
                            <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap text-xs">{item.noPo || '-'}</td>
                            <td className="px-3 py-2.5 text-slate-700 text-xs max-w-[140px] truncate" title={item.alokasi}>{item.alokasi}</td>
                            <td className="px-3 py-2.5 whitespace-nowrap text-xs">
                              <span className="font-mono font-semibold text-red-700 bg-red-50 px-1.5 py-0.5 rounded">{item.kdAkr}</span>
                            </td>
                            <td className="px-3 py-2.5 text-slate-700 text-xs">{item.namaAkun}</td>
                            <td className="px-3 py-2.5 text-slate-500 text-xs max-w-[120px] truncate" title={item.deskripsi || ''}>{item.deskripsi || '-'}</td>
                            <td className="px-3 py-2.5 text-slate-500 text-xs max-w-[120px] truncate" title={item.headerText || ''}>{item.headerText || '-'}</td>
                            <td className="px-3 py-2.5 text-xs">
                              {item.klasifikasi
                                ? <Badge variant="outline" className="text-[8px] px-1.5 py-0 h-4 text-slate-500 border-slate-200">{item.klasifikasi}</Badge>
                                : <span className="text-slate-300 text-xs">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-right font-semibold text-xs text-slate-800 whitespace-nowrap font-mono">{formatCurrency(item.totalAmount)}</td>
                            <td className="px-3 py-2.5 text-center text-xs text-slate-600 whitespace-nowrap">{startDate.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                            <td className="px-3 py-2.5 text-center text-xs text-slate-600 whitespace-nowrap">{finishDate.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                            <td className="px-3 py-2.5 text-center text-xs text-slate-700">{item.period} {item.periodUnit}</td>
                            <td className="px-3 py-2.5 text-right font-semibold text-xs text-slate-800 whitespace-nowrap font-mono">{formatCurrency(item.totalAmount)}</td>
                            <td className="px-3 py-2.5 text-right font-semibold text-xs text-slate-800 whitespace-nowrap font-mono">{formatCurrency(totalAmortisasi)}</td>
                            <td className="px-3 py-2.5 text-right font-semibold text-xs whitespace-nowrap font-mono"
                              style={{ color: saldo > 0 ? '#16a34a' : saldo < 0 ? '#dc2626' : '#64748b' }}>
                              {formatCurrency(saldo)}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <div className="flex items-center justify-center gap-0.5">
                                <button
                                  onClick={() => toggleRow(item.id)}
                                  className="p-1.5 rounded-lg transition-all duration-200 hover:bg-slate-100 active:scale-90 text-slate-500 hover:text-slate-800"
                                  title="Detail Periode"
                                  onMouseEnter={e => gsap.to(e.currentTarget, { scale: 1.18, duration: 0.15 })}
                                  onMouseLeave={e => gsap.to(e.currentTarget, { scale: 1,    duration: 0.15 })}
                                >
                                  {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                </button>
                                {canEdit && (
                                  <>
                                    <button onClick={() => handleEdit(item)}
                                      className="p-1.5 rounded-lg transition-all duration-200 hover:bg-blue-50 text-blue-500 active:scale-90"
                                      title="Edit"
                                      onMouseEnter={e => gsap.to(e.currentTarget, { scale: 1.18, duration: 0.15 })}
                                      onMouseLeave={e => gsap.to(e.currentTarget, { scale: 1,    duration: 0.15 })}>
                                      <Edit size={13} />
                                    </button>
                                    <button onClick={() => handleDelete(item.id)}
                                      className="p-1.5 rounded-lg transition-all duration-200 hover:bg-red-50 text-red-500 active:scale-90"
                                      title="Hapus"
                                      onMouseEnter={e => gsap.to(e.currentTarget, { scale: 1.18, duration: 0.15 })}
                                      onMouseLeave={e => gsap.to(e.currentTarget, { scale: 1,    duration: 0.15 })}>
                                      <Trash2 size={13} />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>

                          {/* ── Expanded Detail Row ─────────────────── */}
                          {isExpanded && (
                            <tr>
                              <td colSpan={17} className="px-0 py-0 bg-gradient-to-r from-red-50/80 to-slate-50 border-b border-red-100">
                                <div className="expand-detail px-6 pt-3 pb-4">
                                  <div className="flex items-center gap-2 mb-3">
                                    <span className="w-1 h-4 rounded-full bg-red-500 inline-block" />
                                    <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Detail Amortisasi — {item.kdAkr}</p>
                                    <Badge variant="outline" className="text-[8px] px-1.5 h-4 text-slate-400 border-slate-200">{periodes.length} periode</Badge>
                                  </div>
                                  {isPeriodeLoading ? (
                                    <div className="flex items-center gap-2 py-4 text-xs text-slate-400">
                                      <div className="w-4 h-4 rounded-full border-2 border-t-red-500 border-red-200 animate-spin" />
                                      Memuat detail periode...
                                    </div>
                                  ) : (
                                  <div className="overflow-x-auto custom-scrollbar rounded-lg border border-red-100">
                                    <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                                      <thead>
                                        <tr style={{ background: 'linear-gradient(90deg,#450a0a,#991b1b)' }}>
                                          {[
                                            'Periode', 'Bulan', 'Amortisasi', 'Status', 'Jurnal SAP',
                                            ...(item.pembagianType === 'manual' && canEdit ? ['Aksi'] : [])
                                          ].map(h => (
                                            <th key={h} className="px-3 py-2 whitespace-nowrap"
                                              style={{
                                                textAlign: h === 'Amortisasi' ? 'right' : 'center',
                                                color: '#fca5a5', fontSize: 9, fontWeight: 600,
                                                textTransform: 'uppercase', letterSpacing: 0.4,
                                              }}>
                                              {h}
                                            </th>
                                          ))}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {periodes.map((p) => {
                                          const parts = p.bulan.split(' ');
                                          const pm = BULAN_MAP[parts[0]] ?? 0;
                                          const py = parseInt(parts[1]);
                                          const periodeDate = new Date(py, pm, 1);
                                          const isPast = periodeDate <= todayFirst;
                                          const displayAmount = item.pembagianType === 'otomatis'
                                            ? (isPast ? p.amountPrepaid : 0)
                                            : p.amountPrepaid;
                                          const isEditing = editingPeriode?.periodeId === p.id;

                                          return (
                                            <tr key={p.id}
                                              className={`transition-colors duration-100 ${!isPast && item.pembagianType === 'otomatis' ? 'bg-slate-50/60 text-slate-400' : 'bg-white hover:bg-red-50/30 text-slate-700'}`}
                                              style={{ borderBottom: '1px solid #fee2e2' }}>
                                              <td className="px-3 py-2 text-center text-xs">{p.periodeKe}</td>
                                              <td className="px-3 py-2 text-center whitespace-nowrap text-xs font-medium">{p.bulan}</td>
                                              <td className="px-3 py-2 text-right font-semibold text-xs font-mono">
                                                {item.pembagianType === 'manual' && isEditing ? (
                                                  <input type="number"
                                                    className="border border-red-300 rounded px-2 py-1 text-xs w-40 text-right focus:outline-none focus:ring-2 focus:ring-red-500"
                                                    value={editingPeriode!.amount}
                                                    onChange={(e) => setEditingPeriode(prev => prev ? { ...prev, amount: e.target.value } : null)}
                                                    onKeyDown={(e) => {
                                                      if (e.key === 'Enter') handleSavePeriodeAmount(p.id, parseFloat(editingPeriode!.amount) || 0, item.id);
                                                      if (e.key === 'Escape') setEditingPeriode(null);
                                                    }}
                                                    autoFocus />
                                                ) : formatCurrency(displayAmount)}
                                              </td>
                                              <td className="px-3 py-2 text-center whitespace-nowrap">
                                                {item.pembagianType === 'otomatis' ? (
                                                  isPast
                                                    ? <span className="inline-flex items-center gap-1 text-[9px] font-bold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full"><CheckCircle size={9} /> Teramortisasi</span>
                                                    : <span className="inline-flex items-center gap-1 text-[9px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full"><Clock size={9} /> Belum</span>
                                                ) : (
                                                  p.amountPrepaid > 0
                                                    ? <span className="inline-flex items-center gap-1 text-[9px] font-bold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full"><CheckCircle size={9} /> Diisi</span>
                                                    : <span className="inline-flex items-center gap-1 text-[9px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full"><Clock size={9} /> Belum</span>
                                                )}
                                              </td>
                                              <td className="px-3 py-2 text-center whitespace-nowrap">
                                                {displayAmount > 0 ? (
                                                  <div className="flex items-center justify-center gap-1">
                                                    <button onClick={() => handleDownloadJurnalSAPPeriode(item, p, displayAmount)}
                                                      className="inline-flex items-center gap-1 text-[9px] font-semibold px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded transition-colors active:scale-90"
                                                      onMouseEnter={ev => gsap.to(ev.currentTarget, { scale: 1.08, duration: 0.13 })}
                                                      onMouseLeave={ev => gsap.to(ev.currentTarget, { scale: 1, duration: 0.13 })}>
                                                      <Download size={9} /> XLS
                                                    </button>
                                                    <button onClick={() => handleDownloadJurnalSAPTxtPeriode(item, p, displayAmount)}
                                                      className="inline-flex items-center gap-1 text-[9px] font-semibold px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors active:scale-90"
                                                      onMouseEnter={ev => gsap.to(ev.currentTarget, { scale: 1.08, duration: 0.13 })}
                                                      onMouseLeave={ev => gsap.to(ev.currentTarget, { scale: 1, duration: 0.13 })}>
                                                      <Download size={9} /> TXT
                                                    </button>
                                                  </div>
                                                ) : <span className="text-slate-300 text-xs">—</span>}
                                              </td>
                                              {item.pembagianType === 'manual' && canEdit && (
                                                <td className="px-3 py-2 text-center">
                                                  {isEditing ? (
                                                    <div className="flex items-center gap-1 justify-center">
                                                      <button
                                                        onClick={() => handleSavePeriodeAmount(p.id, parseFloat(editingPeriode!.amount) || 0, item.id)}
                                                        disabled={savingPeriode}
                                                        className="text-[10px] px-2.5 py-1 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 transition-colors active:scale-95 font-semibold">
                                                        {savingPeriode ? '...' : 'Simpan'}
                                                      </button>
                                                      <button
                                                        onClick={() => setEditingPeriode(null)}
                                                        className="text-[10px] px-2.5 py-1 bg-white border border-gray-200 text-slate-600 rounded hover:bg-gray-50 transition-colors active:scale-95">
                                                        Batal
                                                      </button>
                                                    </div>
                                                  ) : (
                                                    <button
                                                      onClick={() => setEditingPeriode({ prepaidId: item.id, periodeId: p.id, amount: p.amountPrepaid.toString() })}
                                                      className="text-[10px] px-2.5 py-1 bg-white border border-gray-200 text-slate-600 rounded hover:bg-slate-50 transition-colors active:scale-95 font-medium">
                                                      Input
                                                    </button>
                                                  )}
                                                </td>
                                              )}
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Empty state */}
              {filteredData.length === 0 && (
                <div className="text-center py-14">
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-red-50 flex items-center justify-center mb-3">
                    <FileSpreadsheet className="w-7 h-7 text-red-400" />
                  </div>
                  <p className="text-slate-600 font-semibold">Tidak ada data ditemukan</p>
                  <p className="text-slate-400 text-sm mt-1">
                    {searchTerm ? 'Coba ubah kata kunci pencarian' : 'Belum ada data prepaid yang diinput'}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
        {/* Prepaid Form */}
        <PrepaidForm
          isOpen={isFormOpen}
          onClose={() => {
            setIsFormOpen(false);
            setEditData(null);
            setEditMode('create');
          }}
          onSuccess={() => {
            // If editing, bust the periodes cache so the expand row re-fetches fresh data
            if (editMode === 'edit' && editData) {
              setPeriodesCache(prev => {
                const next = { ...prev };
                delete next[editData.id];
                return next;
              });
            }
            fetchPrepaidData();
          }}
          mode={editMode}
          editData={editData}
        />

        {/* ── Processing Overlay ────────────────────────────────────── */}
        {(submitting || importLoading) && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl px-10 py-8 shadow-2xl flex flex-col items-center gap-4 max-w-xs mx-4 border border-red-100">
              <div className="relative w-16 h-16">
                <div className="absolute inset-0 rounded-full border-4 border-red-100" />
                <div className="absolute inset-0 rounded-full border-4 border-t-red-600 border-r-red-300 border-b-transparent border-l-transparent animate-spin" />
                <FileSpreadsheet className="absolute inset-0 m-auto w-7 h-7 text-red-600" />
              </div>
              <div className="text-center">
                <p className="text-base font-bold text-slate-800">
                  {importLoading ? 'Mengimpor data...' : 'Memproses data...'}
                </p>
                <p className="text-xs text-slate-500 mt-1">Mohon tunggu sebentar</p>
              </div>
              <div className="flex gap-1.5">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-2 h-2 rounded-full bg-red-500 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


