'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Download, Plus, Edit, Trash2, ChevronDown, ChevronUp, CheckCircle, Clock, Upload } from 'lucide-react';
import dynamic from 'next/dynamic';
import { exportToCSV } from '../utils/exportUtils';

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
  periodes: PrepaidPeriode[];
}

export default function MonitoringPrepaidPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [prepaidData, setPrepaidData] = useState<Prepaid[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editMode, setEditMode] = useState<'create' | 'edit'>('create');
  const [editData, setEditData] = useState<Prepaid | null>(null);
  const [openDropdown, setOpenDropdown] = useState<number | null>(null);
  const [userRole, setUserRole] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [editingPeriode, setEditingPeriode] = useState<{ prepaidId: number; periodeId: number; amount: string } | null>(null);
  const [savingPeriode, setSavingPeriode] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);

  const bulanMap: Record<string, number> = {
    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'Mei': 4, 'Jun': 5,
    'Jul': 6, 'Agu': 7, 'Sep': 8, 'Okt': 9, 'Nov': 10, 'Des': 11
  };

  const toggleRow = (id: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSavePeriodeAmount = async (periodeId: number, amount: number) => {
    setSavingPeriode(true);
    try {
      const res = await fetch('/api/prepaid/periode', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodeId, amountPrepaid: amount })
      });
      if (res.ok) {
        await fetchPrepaidData();
        setEditingPeriode(null);
      } else {
        alert('Gagal menyimpan amortisasi');
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
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      if (openDropdown !== null) {
        setOpenDropdown(null);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [openDropdown]);

  const fetchPrepaidData = async () => {
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
  };

  // Calculate totals
  const totalPrepaidValue = prepaidData.reduce((sum, item) => sum + item.totalAmount, 0);
  const totalRemaining = prepaidData.reduce((sum, item) => sum + item.remaining, 0);
  const activeItems = prepaidData.length;

  // Filter data
  const filteredData = prepaidData.filter(item => {
    const matchesSearch = searchTerm === '' || 
      item.kdAkr.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.namaAkun.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.vendor.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesSearch;
  });

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
      alert('Gagal membuat laporan. Silakan coba lagi.');
    }
  };

  const handleDownloadJurnalSAP = async () => {
    try {
      const ExcelJSLib = await loadExcelJS();
      const workbook = new ExcelJSLib.Workbook();
      const worksheet = workbook.addWorksheet('Jurnal SAP');
    
    // Headers row 1 (field names)
    worksheet.getRow(1).height = 15;
    const headers1 = [
      'xblnr', 'bukrs', 'blart', 'bldat', 'budat', 'waers', 'kursf', 'bktxt', 
      'zuonr', 'hkont', 'wrbtr', 'sgtxt', 'prctr', 'kostl', '', 'nplnr', 'aufnr', 'valut', 'flag'
    ];
    
    // Kolom dengan warna #FFFF00: kursf (7), zuonr (9), prctr (13), nplnr (16), aufnr (17), valut (18)
    const yellowColumns = [7, 9, 13, 16, 17, 18];
    
    worksheet.getRow(1).values = headers1;
    worksheet.getRow(1).eachCell((cell: any, colNumber: any) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: yellowColumns.includes(colNumber) ? 'FFFFFF00' : 'FFFFE699' }
      };
      cell.font = { name: 'Calibri', size: 11, bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'bottom' };
    });
    
    // Headers row 2 (descriptions)
    worksheet.getRow(2).height = 15;
    const headers2 = [
      'Reference', 'company', 'doc type', 'doc date', 'posting date', 'currency', 'kurs', 
      'header text', 'Vendor/cu:', 'account', 'amount', 'line text', 'profit center', 
      'cost center', '', 'Network', 'order numi', 'value date', ''
    ];
    
    worksheet.getRow(2).values = headers2;
    worksheet.getRow(2).eachCell((cell: any, colNumber: any) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: yellowColumns.includes(colNumber) ? 'FFFFFF00' : 'FFFFE699' }
      };
      cell.font = { name: 'Calibri', size: 11, bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'bottom' };
    });
    
    // Column widths
    worksheet.columns = [
      { width: 12 },  // xblnr
      { width: 10 },  // bukrs
      { width: 9 },   // blart
      { width: 9 },   // bldat
      { width: 12 },  // budat
      { width: 10 },  // waers
      { width: 8 },   // kursf
      { width: 30 },  // bktxt
      { width: 12 },  // zuonr
      { width: 12 },  // hkont
      { width: 15 },  // wrbtr
      { width: 30 },  // sgtxt
      { width: 12 },  // prctr
      { width: 12 },  // kostl
      { width: 3 },   // empty
      { width: 10 },  // nplnr
      { width: 12 },  // aufnr
      { width: 12 },  // valut
      { width: 5 }    // flag
    ];
    
    let currentRow = 3;
    
    // Generate jurnal entries untuk setiap prepaid item
    filteredData.forEach((item) => {
      // Use total amount directly
      const totalAmount = item.totalAmount || 0;
      
      if (totalAmount > 0) {
        // Use current date for document date
        const today = new Date();
        const docDate = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
        
        // Entry 1: DEBIT - Kode Akun Biaya (positive amount)
        const row1 = worksheet.getRow(currentRow);
        row1.height = 15;
        
        row1.getCell(1).value = ''; // xblnr - kosong
        row1.getCell(2).value = item.companyCode || ''; // bukrs
        row1.getCell(3).value = 'SA'; // blart
        row1.getCell(4).value = docDate; // bldat
        row1.getCell(5).value = docDate; // budat
        row1.getCell(6).value = 'IDR'; // waers
        row1.getCell(7).value = ''; // kursf
        row1.getCell(8).value = item.headerText || ''; // bktxt
        row1.getCell(9).value = ''; // zuonr
        row1.getCell(10).value = item.namaAkun; // hkont (expense account)
        row1.getCell(11).value = totalAmount; // wrbtr (positive)
        row1.getCell(11).numFmt = '0';
        row1.getCell(12).value = item.headerText || ''; // sgtxt
        row1.getCell(13).value = ''; // prctr
        row1.getCell(14).value = ''; // kostl - kosongkan untuk akun biaya
        row1.getCell(15).value = ''; // empty
        row1.getCell(16).value = ''; // nplnr
        row1.getCell(17).value = ''; // aufnr
        row1.getCell(18).value = ''; // valut
        row1.getCell(19).value = 'G'; // flag
        
        // Apply font and alignment to all cells (NO BORDERS)
        for (let col = 1; col <= 19; col++) {
          const cell = row1.getCell(col);
          cell.font = { name: 'Aptos Narrow', size: 12 };
          if (col === 11) {
            cell.alignment = { horizontal: 'right', vertical: 'bottom' };
          } else {
            cell.alignment = { horizontal: 'left', vertical: 'bottom' };
          }
        }
        
        currentRow++;
        
        // Entry 2: KREDIT - Kode Akun Prepaid (negative amount)
        const row2 = worksheet.getRow(currentRow);
        row2.height = 15;
        
        row2.getCell(1).value = ''; // xblnr - kosong
        row2.getCell(2).value = item.companyCode || ''; // bukrs
        row2.getCell(3).value = 'SA'; // blart
        row2.getCell(4).value = docDate; // bldat
        row2.getCell(5).value = docDate; // budat
        row2.getCell(6).value = 'IDR'; // waers
        row2.getCell(7).value = ''; // kursf
        row2.getCell(8).value = item.headerText || ''; // bktxt
        row2.getCell(9).value = ''; // zuonr
        row2.getCell(10).value = item.kdAkr; // hkont (prepaid account)
        row2.getCell(11).value = -totalAmount; // wrbtr (negative)
        row2.getCell(11).numFmt = '0';
        row2.getCell(12).value = item.headerText || ''; // sgtxt
        row2.getCell(13).value = ''; // prctr
        row2.getCell(14).value = item.alokasi || ''; // kostl - isi cost center untuk realisasi prepaid
        row2.getCell(15).value = ''; // empty
        row2.getCell(16).value = ''; // nplnr
        row2.getCell(17).value = ''; // aufnr
        row2.getCell(18).value = ''; // valut
        row2.getCell(19).value = 'G'; // flag
        
        // Apply font and alignment to all cells (NO BORDERS)
        for (let col = 1; col <= 19; col++) {
          const cell = row2.getCell(col);
          cell.font = { name: 'Aptos Narrow', size: 12 };
          if (col === 11) {
            cell.alignment = { horizontal: 'right', vertical: 'bottom' };
          } else {
            cell.alignment = { horizontal: 'left', vertical: 'bottom' };
          }
        }
        
        currentRow++;
      }
    });
    
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { 
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Jurnal_SAP_Prepaid_${new Date().getFullYear()}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error generating Jurnal SAP:', error);
      alert('Gagal membuat jurnal SAP. Silakan coba lagi.');
    }
  };

  const handleDownloadJurnalSAPTxt = () => {
    // Build TXT content (tab-separated)
    const rows: string[][] = [];
    
    // Generate jurnal entries (no headers)
    filteredData.forEach((item) => {
      // Use total amount directly
      const totalAmount = item.totalAmount || 0;
      
      if (totalAmount > 0) {
        const today = new Date();
        const docDate = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
        
        // Entry 1: DEBIT - Kode Akun Biaya (positive amount)
        rows.push([
          '',
          item.companyCode || '',
          'SA',
          docDate,
          docDate,
          'IDR',
          '',
          item.headerText || '',
          '',
          item.namaAkun,
          totalAmount.toString(),
          item.headerText || '',
          '',
          '', // Cost center kosong untuk akun biaya
          '',
          '',
          '',
          '',
          'G'
        ]);
        
        // Entry 2: KREDIT - Kode Akun Prepaid (negative amount)
        rows.push([
          '',
          item.companyCode || '',
          'SA',
          docDate,
          docDate,
          'IDR',
          '',
          item.headerText || '',
          '',
          item.kdAkr,
          (-totalAmount).toString(),
          item.headerText || '',
          '',
          item.alokasi || '', // Cost center untuk realisasi prepaid
          '',
          '',
          '',
          '',
          'G'
        ]);
      }
    });
    
    // Convert to TXT string (tab-separated)
    const txtContent = rows.map(row => row.join('\t')).join('\n');
    
    // Create blob and download
    const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Jurnal_SAP_Prepaid_${new Date().getFullYear()}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
      const pm = bulanMap[parts[0]] ?? 0;
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
      alert('Gagal membuat jurnal SAP. Silakan coba lagi.');
    }
  };

  const handleDownloadJurnalSAPTxtPeriode = (item: Prepaid, periode: PrepaidPeriode, amount: number) => {
    if (!amount || amount <= 0) return;
    const parts = periode.bulan.split(' ');
    const pm = bulanMap[parts[0]] ?? 0;
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
        const reasonMsg = result.skipReasons?.length
          ? `\n\nAlasan dilewati (${result.skipReasons.length}):\n${result.skipReasons.slice(0, 5).join('\n')}`
          : '';
        alert(`Import berhasil!\n✅ ${result.created} data diimpor\n⏭ ${result.skipped} baris dilewati${reasonMsg}`);
        await fetchPrepaidData();
      } else {
        alert(`Gagal mengimpor: ${result.error}`);
      }
    } catch (err) {
      alert('Terjadi kesalahan saat mengimpor file');
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
      alert(data.count != null ? `${data.count} data berhasil dihapus.` : 'Data berhasil dihapus.');
    } catch (error) {
      console.error('Error bulk delete:', error);
      alert('Gagal menghapus data terpilih');
    } finally {
      setDeletingSelected(false);
    }
  }, [selectedIds]);

  const handleEdit = (item: Prepaid) => {
    setEditData(item);
    setEditMode('edit');
    setIsFormOpen(true);
    setOpenDropdown(null);
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
        alert('Data prepaid berhasil dihapus!');
        fetchPrepaidData();
      } else {
        alert('Gagal menghapus data prepaid');
      }
    } catch (error) {
      console.error('Error deleting prepaid:', error);
      alert('Terjadi kesalahan saat menghapus data');
    }
    setOpenDropdown(null);
  };

  const handleExportSingle = (item: Prepaid) => {
    const headers = ['companyCode', 'noPo', 'alokasi', 'kdAkr', 'namaAkun', 'deskripsi', 'klasifikasi', 'totalAmount', 'startDate', 'period', 'remaining'];
    exportToCSV([item], `Prepaid_${item.kdAkr}.csv`, headers);
    setOpenDropdown(null);
  };

  const handleAddNew = () => {
    setEditData(null);
    setEditMode('create');
    setIsFormOpen(true);
  };

  const formatCurrency = (amount: number) => {
    return `Rp ${Math.round(amount).toLocaleString('id-ID')}`;
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
        {/* Header */}
        <Header
          title="Monitoring Prepaid"
          onMenuClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
          subtitle="Monitoring dan input data prepaid dengan laporan SAP"
        />

        {/* Content Area */}
        <div className="p-4 sm:p-6 md:p-8 bg-gray-50">
          {/* Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 md:gap-6 mb-4 sm:mb-6 md:mb-8">
            <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
              <p className="text-xs sm:text-sm text-gray-600 mb-1 sm:mb-2">Total Prepaid Value</p>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-800">
                {formatCurrency(totalPrepaidValue)}
              </h3>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
              <p className="text-xs sm:text-sm text-gray-600 mb-1 sm:mb-2">Remaining Amount</p>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-800">
                {formatCurrency(totalRemaining)}
              </h3>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
              <p className="text-xs sm:text-sm text-gray-600 mb-1 sm:mb-2">Active Items</p>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-800">{activeItems}</h3>
            </div>
          </div>

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
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".xlsx,.xls,.xlsb"
                  className="hidden"
                  onChange={handleImportExcel}
                />
                <button
                  onClick={() => importFileRef.current?.click()}
                  disabled={importLoading}
                  className="flex items-center gap-1 sm:gap-2 bg-red-600 hover:bg-red-700 !text-white px-2 sm:px-4 py-2 rounded-lg transition-colors text-xs sm:text-sm font-medium flex-1 sm:flex-initial justify-center disabled:opacity-60"
                >
                  <Upload size={16} className="sm:w-[18px] sm:h-[18px]" />
                  <span className="hidden sm:inline">{importLoading ? 'Mengimpor...' : 'Import Excel'}</span>
                  <span className="sm:hidden">{importLoading ? '...' : 'Import'}</span>
                </button>
                <button
                  onClick={handleDownloadGlobalReport}
                  className="flex items-center gap-1 sm:gap-2 bg-red-600 hover:bg-red-700 !text-white px-2 sm:px-4 py-2 rounded-lg transition-colors text-xs sm:text-sm font-medium flex-1 sm:flex-initial justify-center"
                >
                  <Download size={16} className="sm:w-[18px] sm:h-[18px]" />
                  <span className="hidden sm:inline">Export Laporan Prepaid</span>
                  <span className="sm:hidden">Laporan</span>
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
                    onClick={handleAddNew}
                    className="flex items-center gap-1 sm:gap-2 bg-red-600 hover:bg-red-700 !text-white px-2 sm:px-4 py-2 rounded-lg transition-colors text-xs sm:text-sm font-medium w-full sm:w-auto justify-center"
                  >
                    <Plus size={16} className="sm:w-[18px] sm:h-[18px]" />
                    <span className="hidden sm:inline">Tambah Data Prepaid</span>
                    <span className="sm:hidden">Tambah Data</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <style jsx>{`
              .custom-scrollbar::-webkit-scrollbar {
                height: 10px;
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
            {loading ? (
              <div className="text-center py-12">
                <p className="text-gray-500">Memuat data...</p>
              </div>
            ) : (
              <div className="overflow-x-auto overflow-y-auto max-w-full bg-white custom-scrollbar" style={{ maxHeight: 'calc(100vh - 400px)', width: '100%' }}>
                <table className="w-full text-sm bg-white min-w-max">
                  <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                    <tr className="bg-gray-50">
                      <th className="px-3 py-3 text-center text-xs font-semibold text-gray-700 w-10">
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500 cursor-pointer"
                          checked={filteredData.length > 0 && filteredData.every((item) => selectedIds.has(item.id))}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedIds(new Set(filteredData.map((item) => item.id)));
                            } else {
                              setSelectedIds(new Set());
                            }
                          }}
                          title="Pilih semua"
                        />
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 whitespace-nowrap">
                        Company Code
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 whitespace-nowrap">
                        No PO
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 whitespace-nowrap">
                        Assignment/Order
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 whitespace-nowrap">
                        Kode Akun Prepaid
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 whitespace-nowrap">
                        Kode Akun Biaya
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700">
                        Deskripsi
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700">
                        Header Text
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700">
                        Klasifikasi
                      </th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700">
                        Amount
                      </th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-gray-700 whitespace-nowrap">
                        Start Date
                      </th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-gray-700 whitespace-nowrap">
                        Finish Date
                      </th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-gray-700">
                        Periode
                      </th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700 whitespace-nowrap">
                        Total Prepaid
                      </th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700 whitespace-nowrap">
                        Total Amortisasi
                      </th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700">
                        Saldo
                      </th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-gray-700">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredData.map((item) => {
                      const startDate = new Date(item.startDate);
                      const finishDate = new Date(startDate);
                      finishDate.setMonth(finishDate.getMonth() + item.period - 1);

                      const totalAmortisasi = item.totalAmortisasi ?? (item.totalAmount - item.remaining);
                      const saldo = item.totalAmount - totalAmortisasi;
                      const isExpanded = expandedRows.has(item.id);

                      const today = new Date();
                      const todayFirst = new Date(today.getFullYear(), today.getMonth(), 1);

                      return (
                        <React.Fragment key={item.id}>
                          <tr className="hover:bg-gray-50 transition-colors">
                          <td className="px-3 py-3 text-center">
                            <input
                              type="checkbox"
                              className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500 cursor-pointer"
                              checked={selectedIds.has(item.id)}
                              onChange={(e) => {
                                setSelectedIds((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(item.id); else next.delete(item.id);
                                  return next;
                                });
                              }}
                            />
                          </td>
                          <td className="px-3 py-3 text-gray-800 whitespace-nowrap">
                            {item.companyCode || '-'}
                          </td>
                          <td className="px-3 py-3 text-gray-800 whitespace-nowrap">
                            {item.noPo || '-'}
                          </td>
                          <td className="px-3 py-3 text-gray-800">
                            {item.alokasi}
                          </td>
                          <td className="px-3 py-3 text-gray-800 whitespace-nowrap">
                            {item.kdAkr}
                          </td>
                          <td className="px-3 py-3 text-gray-800">
                            {item.namaAkun}
                          </td>
                          <td className="px-3 py-3 text-gray-600">
                            {item.deskripsi || '-'}
                          </td>
                          <td className="px-3 py-3 text-gray-600">
                            {item.headerText || '-'}
                          </td>
                          <td className="px-3 py-3 text-gray-600">
                            {item.klasifikasi || '-'}
                          </td>
                          <td className="px-3 py-3 text-right font-medium text-gray-800">
                            {formatCurrency(item.totalAmount)}
                          </td>
                          <td className="px-3 py-3 text-center text-gray-800 whitespace-nowrap">
                            {startDate.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </td>
                          <td className="px-3 py-3 text-center text-gray-800 whitespace-nowrap">
                            {finishDate.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </td>
                          <td className="px-3 py-3 text-center text-gray-800">
                            {item.period} {item.periodUnit}
                          </td>
                          <td className="px-3 py-3 text-right font-medium text-gray-800">
                            {formatCurrency(item.totalAmount)}
                          </td>
                          <td className="px-3 py-3 text-right font-medium text-gray-800">
                            {formatCurrency(totalAmortisasi)}
                          </td>
                          <td className="px-3 py-3 text-right font-medium text-gray-800">
                            {formatCurrency(saldo)}
                          </td>
                          <td className="px-3 py-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => toggleRow(item.id)}
                                className="text-gray-600 hover:text-gray-800 transition-colors p-1 hover:bg-gray-100 rounded"
                                title="Detail Periode"
                              >
                                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                              </button>
                              {canEdit && (
                                <>
                                  <button
                                    onClick={() => handleEdit(item)}
                                    className="text-blue-600 hover:text-blue-800 transition-colors p-1 hover:bg-blue-50 rounded"
                                    title="Edit"
                                  >
                                    <Edit size={16} className="sm:w-[18px] sm:h-[18px]" />
                                  </button>
                                  <button
                                    onClick={() => handleDelete(item.id)}
                                    className="text-red-600 hover:text-red-800 transition-colors p-1 hover:bg-red-50 rounded"
                                    title="Hapus"
                                  >
                                    <Trash2 size={16} className="sm:w-[18px] sm:h-[18px]" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={17} className="px-0 py-0 bg-gray-50 border-b border-gray-200">
                              <div className="px-8 pt-2 pb-4">
                                <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
                                  Detail Amortisasi
                                </p>
                              </div>
                              <table className="w-full text-sm bg-white">
                                  <thead className="bg-gray-100 border-y border-gray-200">
                                    <tr>
                                      <th className="px-3 py-3 text-center text-xs font-semibold text-gray-700 whitespace-nowrap">Periode</th>
                                      <th className="px-3 py-3 text-center text-xs font-semibold text-gray-700 whitespace-nowrap">Bulan</th>
                                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700 whitespace-nowrap">Amortisasi</th>
                                      <th className="px-3 py-3 text-center text-xs font-semibold text-gray-700 whitespace-nowrap">Status</th>
                                      <th className="px-3 py-3 text-center text-xs font-semibold text-gray-700 whitespace-nowrap">Jurnal SAP</th>
                                      {item.pembagianType === 'manual' && canEdit && (
                                        <th className="px-3 py-3 text-center text-xs font-semibold text-gray-700 whitespace-nowrap">Aksi</th>
                                      )}
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-200">
                                    {item.periodes.map((p) => {
                                      const parts = p.bulan.split(' ');
                                      const pm = bulanMap[parts[0]] ?? 0;
                                      const py = parseInt(parts[1]);
                                      const periodeDate = new Date(py, pm, 1);
                                      const isPast = periodeDate <= todayFirst;
                                      const displayAmount = item.pembagianType === 'otomatis'
                                        ? (isPast ? p.amountPrepaid : 0)
                                        : p.amountPrepaid;
                                      const isEditing = editingPeriode?.periodeId === p.id;

                                      return (
                                        <tr key={p.id} className={`hover:bg-gray-50 transition-colors ${!isPast && item.pembagianType === 'otomatis' ? 'text-gray-400' : 'text-gray-800'}`}>
                                          <td className="px-3 py-3 text-center">{p.periodeKe}</td>
                                          <td className="px-3 py-3 text-center whitespace-nowrap">{p.bulan}</td>
                                          <td className="px-3 py-3 text-right font-medium">
                                            {item.pembagianType === 'manual' && isEditing ? (
                                              <input
                                                type="number"
                                                className="border border-gray-300 rounded px-2 py-1 text-sm w-44 text-right focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                                                value={editingPeriode!.amount}
                                                onChange={(e) => setEditingPeriode(prev => prev ? { ...prev, amount: e.target.value } : null)}
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter') handleSavePeriodeAmount(p.id, parseFloat(editingPeriode!.amount) || 0);
                                                  if (e.key === 'Escape') setEditingPeriode(null);
                                                }}
                                                autoFocus
                                              />
                                            ) : (
                                              formatCurrency(displayAmount)
                                            )}
                                          </td>
                                          <td className="px-3 py-3 text-center whitespace-nowrap">
                                            {item.pembagianType === 'otomatis' ? (
                                              isPast
                                                ? <span className="inline-flex items-center gap-1 text-green-600"><CheckCircle size={13} /> Teramortisasi</span>
                                                : <span className="inline-flex items-center gap-1 text-gray-400"><Clock size={13} /> Belum</span>
                                            ) : (
                                              p.amountPrepaid > 0
                                                ? <span className="inline-flex items-center gap-1 text-green-600"><CheckCircle size={13} /> Diisi</span>
                                                : <span className="inline-flex items-center gap-1 text-gray-400"><Clock size={13} /> Belum</span>
                                            )}
                                          </td>
                                          {/* Jurnal SAP per periode */}
                                          <td className="px-3 py-3 text-center whitespace-nowrap">
                                            {displayAmount > 0 ? (
                                              <div className="flex items-center justify-center gap-1">
                                                <button
                                                  onClick={() => handleDownloadJurnalSAPPeriode(item, p, displayAmount)}
                                                  className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded transition-colors"
                                                  title="Download Jurnal SAP Excel"
                                                >
                                                  <Download size={11} /> XLS
                                                </button>
                                                <button
                                                  onClick={() => handleDownloadJurnalSAPTxtPeriode(item, p, displayAmount)}
                                                  className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                                                  title="Download Jurnal SAP TXT"
                                                >
                                                  <Download size={11} /> TXT
                                                </button>
                                              </div>
                                            ) : (
                                              <span className="text-gray-300 text-xs">—</span>
                                            )}
                                          </td>
                                          {item.pembagianType === 'manual' && canEdit && (
                                            <td className="px-3 py-3 text-center">
                                              {isEditing ? (
                                                <div className="flex items-center gap-1 justify-center">
                                                  <button
                                                    onClick={() => handleSavePeriodeAmount(p.id, parseFloat(editingPeriode!.amount) || 0)}
                                                    disabled={savingPeriode}
                                                    className="text-xs px-3 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
                                                  >
                                                    {savingPeriode ? '...' : 'Simpan'}
                                                  </button>
                                                  <button
                                                    onClick={() => setEditingPeriode(null)}
                                                    className="text-xs px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 transition-colors"
                                                  >
                                                    Batal
                                                  </button>
                                                </div>
                                              ) : (
                                                <button
                                                  onClick={() => setEditingPeriode({ prepaidId: item.id, periodeId: p.id, amount: p.amountPrepaid.toString() })}
                                                  className="text-xs px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 transition-colors"
                                                >
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
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Empty State */}
            {!loading && filteredData.length === 0 && (
              <div className="text-center py-12">
                <p className="text-gray-500">Tidak ada data yang ditemukan</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Prepaid Form Modal */}
      <PrepaidForm
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setEditData(null);
          setEditMode('create');
        }}
        onSuccess={fetchPrepaidData}
        mode={editMode}
        editData={editData}
      />

      {/* Loading Overlay untuk proses yang memakan waktu */}
      {submitting && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 sm:p-8 shadow-2xl flex flex-col items-center space-y-4 max-w-sm mx-4">
            <div className="animate-spin rounded-full h-12 w-12 sm:h-16 sm:w-16 border-4 border-red-600 border-t-transparent"></div>
            <div className="text-center">
              <p className="text-base sm:text-lg font-semibold text-gray-800">Memproses data...</p>
              <p className="text-xs sm:text-sm text-gray-500 mt-1">Mohon tunggu sebentar</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
