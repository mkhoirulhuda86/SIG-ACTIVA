'use client';

import { toast } from 'sonner';
import { useState, useMemo, useEffect, useRef, useCallback, startTransition } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import {
  Download, Search, AlertCircle, TrendingDown, Package,
  MapPin, Calculator, FolderOpen, Navigation, Clock,
} from 'lucide-react';
import { gsap } from 'gsap';
import { animate, stagger } from 'animejs';

import Sidebar from '../components/Sidebar';
import Header from '../components/Header';
import ExcelImport from '../components/ExcelImport';
import MaterialPivotTable from '../components/MaterialPivotTable';
import { exportToExcel } from '../utils/exportUtils';
import { useRealtimeUpdates } from '@/hooks/useRealtimeUpdates';
import { useGSAPCounter } from '@/hooks/useGSAP';

import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';

/* ─── types ──────────────────────────────────────────────────────────── */
interface MaterialData {
  materialId: string;
  materialName: string;
  location: string;
  stokAwal: { opr: number; sap: number; selisih: number; total: number };
  produksi: { opr: number; sap: number; selisih: number; total: number };
  rilis: { opr: number; sap: number; selisih: number; total: number };
  stokAkhir: { opr: number; sap: number; selisih: number; total: number };
  blank: number;
  blankTotal: number;
  grandTotal: number;
}

/* ─── animated metric card ───────────────────────────────────────────── */
function MetricCardAnimated({
  icon: Icon,
  label,
  value,
  sub,
  delay = 0,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  sub: string;
  delay?: number;
}) {
  const [displayed, setDisplayed] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    gsap.fromTo(el,
      { opacity: 0, y: 32, scale: 0.94 },
      { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: 'power3.out', delay: delay / 1000 }
    );
  }, [delay]);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const onEnter = () => gsap.to(el, { y: -4, scale: 1.03, duration: 0.25, ease: 'power2.out' });
    const onLeave = () => gsap.to(el, { y: 0, scale: 1, duration: 0.25, ease: 'power2.out' });
    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);
    return () => { el.removeEventListener('mouseenter', onEnter); el.removeEventListener('mouseleave', onLeave); };
  }, []);

  useGSAPCounter(value, setDisplayed, [value], { duration: 1.4, delay: delay / 1000 + 0.15 });

  return (
    <div ref={cardRef} className="bg-white rounded-xl p-4 sm:p-5 border border-gray-200 shadow-sm cursor-default select-none">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-9 h-9 sm:w-10 sm:h-10 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
          <Icon className="text-red-600" size={16} />
        </div>
        <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide leading-tight">{label}</p>
      </div>
      <p className="text-2xl sm:text-3xl font-extrabold text-gray-900 tabular-nums">
        {Math.round(displayed).toLocaleString('id-ID')}
      </p>
      <p className="text-xs text-gray-400 mt-1">{sub}</p>
    </div>
  );
}

/* ─── loading skeleton ────────────────────────────────────────────────── */
function LoadingSkeleton() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    gsap.fromTo(el, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out' });
  }, []);
  return (
    <div ref={ref} className="space-y-4 sm:space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="space-y-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="h-9 w-32 rounded-lg" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-gray-50 rounded-xl p-4 border border-gray-100 space-y-3">
              <div className="flex items-center gap-2">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {[0, 1].map(i => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 sm:p-6 space-y-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="space-y-1">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
            <Skeleton className="h-48 w-full rounded-lg" />
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <Skeleton className="h-5 w-56" />
        </div>
        <div className="p-4 space-y-2">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded" />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-center gap-3 py-2">
        <div className="w-5 h-5 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-gray-500 animate-pulse">Memuat data dari database…</span>
      </div>
    </div>
  );
}

/* ─── main page ──────────────────────────────────────────────────────── */
export default function LaporanMaterialPage() {
  const [selectedLokasi, setSelectedLokasi] = useState('All');
  const [selectedFasilitas, setSelectedFasilitas] = useState('all');
  const [selectedKategori, setSelectedKategori] = useState('all');
  const [selectedSelisih, setSelectedSelisih] = useState('ada selisih');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [importedData, setImportedData] = useState<MaterialData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [historyDates, setHistoryDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [userRole, setUserRole] = useState<string>('');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [materialRefreshKey, setMaterialRefreshKey] = useState(0);

  const pageRef      = useRef<HTMLDivElement>(null);
  const historySectionRef = useRef<HTMLDivElement>(null);
  const statsSectionRef   = useRef<HTMLDivElement>(null);
  const chartsSectionRef  = useRef<HTMLDivElement>(null);
  const filtersSectionRef = useRef<HTMLDivElement>(null);
  const tableSectionRef   = useRef<HTMLDivElement>(null);
  const exportBtnRef      = useRef<HTMLButtonElement>(null);

  /* page enter */
  useEffect(() => {
    if (pageRef.current)
      gsap.fromTo(pageRef.current, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' });
  }, []);

  /* export btn hover */
  useEffect(() => {
    const el = exportBtnRef.current;
    if (!el) return;
    const enter = () => gsap.to(el, { scale: 1.06, duration: 0.2, ease: 'power2.out' });
    const leave = () => gsap.to(el, { scale: 1, duration: 0.2, ease: 'power2.out' });
    el.addEventListener('mouseenter', enter);
    el.addEventListener('mouseleave', leave);
    return () => { el.removeEventListener('mouseenter', enter); el.removeEventListener('mouseleave', leave); };
  }, []);

  /* history section anim */
  useEffect(() => {
    const el = historySectionRef.current;
    if (!el || historyDates.length === 0) return;
    animate(el, { opacity: [0, 1], translateY: [18, 0], scale: [0.97, 1], duration: 420, ease: 'easeOutExpo' });
  }, [historyDates]);

  /* data sections anim */
  useEffect(() => {
    if (importedData.length === 0) return;
    const run = async () => {
      await new Promise<void>(r => setTimeout(r, 60));
      if (statsSectionRef.current)
        gsap.fromTo(statsSectionRef.current, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.55, ease: 'power3.out' });
      if (chartsSectionRef.current) {
        const charts = chartsSectionRef.current.querySelectorAll('.chart-panel');
        gsap.fromTo(charts, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out', stagger: 0.12, delay: 0.1 });
      }
      if (filtersSectionRef.current) {
        const items = filtersSectionRef.current.querySelectorAll('.filter-item');
        animate(items, { opacity: [0, 1], translateX: [-14, 0], duration: 320, delay: stagger(55, { start: 80 }), ease: 'easeOutExpo' });
      }
      if (tableSectionRef.current)
        gsap.fromTo(tableSectionRef.current, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.55, ease: 'power3.out', delay: 0.25 });
    };
    run();
  }, [importedData]);

  /* ── original logic ────────────────────────────────────────────────── */
  useEffect(() => { setUserRole(localStorage.getItem('userRole') || ''); }, []);
  const canEdit = userRole === 'ADMIN_SYSTEM' || userRole === 'STAFF_ACCOUNTING';

  // Fetch data for a specific import date (used when user picks from dropdown)
  const fetchDataForDate = useCallback(async (date: string) => {
    if (!date) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/material-data?importDate=${encodeURIComponent(date)}`);
      if (res.ok) setImportedData(await res.json());
      else console.error('Failed to load data, status:', res.status);
    } catch (e) { console.error('Error loading material data:', e); }
    finally { setIsLoading(false); }
  }, []);

  // On mount / refresh: single request returns history + latest data together (1 HTTP round-trip)
  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      try {
        const res = await fetch('/api/material-data?action=init');
        if (res.ok) {
          const { history, data } = await res.json();
          const sorted = (history as string[]).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
          setHistoryDates(sorted);
          if (sorted.length > 0) setSelectedDate(sorted[0]);
          setImportedData(data);
        }
      } catch (error) { console.error('Error initialising material page:', error); }
      finally { setIsLoading(false); }
    };
    init();
  }, [materialRefreshKey]);

  useRealtimeUpdates(['material'], () => { setMaterialRefreshKey(k => k + 1); });

  // Debounced search – only re-filter after 280 ms of inactivity
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchInput(val);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => startTransition(() => setSearchTerm(val)), 280);
  }, []);

  // Cleanup debounce timer on unmount
  useEffect(() => () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); }, []);

  // User explicitly picks a different import date from the dropdown
  const handleDateChange = useCallback((date: string) => {
    setSelectedDate(date);
    fetchDataForDate(date);
  }, [fetchDataForDate]);

  const uniqueLocations = useMemo(() => {
    if (importedData.length === 0) return ['All'];
    const locations = new Set(importedData.map(item => item.location).filter(Boolean));
    return ['All', ...Array.from(locations)];
  }, [importedData]);

  const dynamicStats = useMemo(() => {
    if (importedData.length === 0)
      return { totalSelisih: 0, selisihPerKategori: { stokAwal: 0, produksi: 0, rilis: 0, stokAkhir: 0 }, selisihPerLokasi: {} };
    const stats = {
      totalSelisih: 0,
      selisihPerKategori: { stokAwal: 0, produksi: 0, rilis: 0, stokAkhir: 0 },
      selisihPerLokasi: {} as Record<string, number>,
      selisihPerFasilitas: { pabrik: 0, gudang: 0 },
    };
    importedData.forEach(item => {
      const s0 = item.stokAwal?.selisih || 0, s1 = item.produksi?.selisih || 0,
            s2 = item.rilis?.selisih || 0,   s3 = item.stokAkhir?.selisih || 0;
      const tot = s0 + s1 + s2 + s3;
      stats.totalSelisih += tot;
      stats.selisihPerKategori.stokAwal += s0;
      stats.selisihPerKategori.produksi += s1;
      stats.selisihPerKategori.rilis    += s2;
      stats.selisihPerKategori.stokAkhir+= s3;
      const loc = item.location || 'Unknown';
      if (!stats.selisihPerLokasi[loc]) stats.selisihPerLokasi[loc] = 0;
      stats.selisihPerLokasi[loc] += tot;
      const ll = loc.toLowerCase();
      if (ll.includes('pl') || ll.includes('cp')) stats.selisihPerFasilitas.pabrik += tot;
      else stats.selisihPerFasilitas.gudang += tot;
    });
    return stats;
  }, [importedData]);

  const additionalMetrics = useMemo(() => {
    const totalMaterials = new Set(importedData.map(item => item.materialId)).size;
    const totalLocations = new Set(importedData.map(item => item.location)).size;
    const avgSelisihPerMaterial = totalMaterials > 0 ? dynamicStats.totalSelisih / totalMaterials : 0;
    const lokasiWithMaxSelisih = Object.entries(dynamicStats.selisihPerLokasi)
      .reduce((max, [loc, val]) => Math.abs(val) > Math.abs(max.value) ? { location: loc, value: val } : max, { location: 'N/A', value: 0 });
    return { totalMaterials, totalLocations, avgSelisihPerMaterial, highestSelisihLocation: lokasiWithMaxSelisih };
  }, [importedData, dynamicStats]);

  const volumeSelisihPerKategori = useMemo(() => [
    { name: 'Stok Awal', value: dynamicStats.selisihPerKategori.stokAwal },
    { name: 'Produksi',  value: dynamicStats.selisihPerKategori.produksi },
    { name: 'Rilis',     value: dynamicStats.selisihPerKategori.rilis },
    { name: 'Stok Akhir',value: dynamicStats.selisihPerKategori.stokAkhir },
  ], [dynamicStats]);

  const volumeSelisihPerLokasi = useMemo(() =>
    Object.entries(dynamicStats.selisihPerLokasi)
      .map(([name, value]) => ({ name: name.length > 20 ? name.substring(0, 17) + '...' : name, fullName: name, value }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 10),
  [dynamicStats]);

  const filteredData = useMemo(() => {
    if (importedData.length === 0) return [];
    return importedData.filter(item => {
      const matchesSearch = searchTerm === '' ||
        item.materialId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.materialName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.location?.toLowerCase().includes(searchTerm.toLowerCase());
      let matchesSelisih = true;
      if (selectedSelisih === 'ada selisih') {
        const sp1 = (item.stokAwal?.opr || 0) !== 0 ? Math.abs((item.stokAwal?.selisih || 0) / (item.stokAwal?.opr || 0)) * 100 : 0;
        const sp2 = (item.stokAkhir?.opr || 0) !== 0 ? Math.abs((item.stokAkhir?.selisih || 0) / (item.stokAkhir?.opr || 0)) * 100 : 0;
        matchesSelisih = sp1 > 5 || sp2 > 5;
      }
      if (selectedSelisih === 'all') {
        const matchesLokasi = selectedLokasi === 'All' || item.location === selectedLokasi;
        let matchesFasilitas = true;
        if (selectedFasilitas !== 'all') {
          const ll = (item.location || '').toLowerCase();
          if (selectedFasilitas === 'pabrik') matchesFasilitas = ll.includes('pl') || ll.includes('cp');
          else if (selectedFasilitas === 'gudang') matchesFasilitas = !ll.includes('pl') && !ll.includes('cp');
        }
        let matchesKategori = true;
        if (selectedKategori !== 'all') {
          if (selectedKategori === 'stok awal')  matchesKategori = Math.abs(item.stokAwal?.selisih  || 0) >= 1;
          else if (selectedKategori === 'produksi')   matchesKategori = Math.abs(item.produksi?.selisih   || 0) >= 1;
          else if (selectedKategori === 'rilis')       matchesKategori = Math.abs(item.rilis?.selisih      || 0) >= 1;
          else if (selectedKategori === 'stok akhir') matchesKategori = Math.abs(item.stokAkhir?.selisih  || 0) >= 1;
        } else {
          matchesKategori = (Math.abs(item.stokAwal?.selisih||0)>=1||Math.abs(item.produksi?.selisih||0)>=1||Math.abs(item.rilis?.selisih||0)>=1||Math.abs(item.stokAkhir?.selisih||0)>=1);
        }
        return matchesSearch && matchesLokasi && matchesFasilitas && matchesKategori;
      }
      let matchesLokasi = true;
      if (selectedLokasi !== 'All') {
        const hasS = (Math.abs(item.stokAwal?.selisih||0)>=1&&(item.stokAwal?.opr||0)!==0)||(Math.abs(item.produksi?.selisih||0)>=1&&(item.produksi?.opr||0)!==0)||(Math.abs(item.rilis?.selisih||0)>=1&&(item.rilis?.opr||0)!==0)||(Math.abs(item.stokAkhir?.selisih||0)>=1&&(item.stokAkhir?.opr||0)!==0);
        matchesLokasi = item.location === selectedLokasi && hasS;
      }
      let matchesFasilitas = true;
      if (selectedFasilitas !== 'all') {
        const ll = (item.location || '').toLowerCase();
        const hasS = (Math.abs(item.stokAwal?.selisih||0)>=1&&(item.stokAwal?.opr||0)!==0)||(Math.abs(item.produksi?.selisih||0)>=1&&(item.produksi?.opr||0)!==0)||(Math.abs(item.rilis?.selisih||0)>=1&&(item.rilis?.opr||0)!==0)||(Math.abs(item.stokAkhir?.selisih||0)>=1&&(item.stokAkhir?.opr||0)!==0);
        if (selectedFasilitas === 'pabrik') matchesFasilitas = (ll.includes('pl')||ll.includes('cp')) && hasS;
        else if (selectedFasilitas === 'gudang') matchesFasilitas = (!ll.includes('pl')&&!ll.includes('cp')) && hasS;
      }
      let matchesKategori = true;
      if (selectedKategori !== 'all') {
        if (selectedKategori === 'stok awal')  matchesKategori = Math.abs(item.stokAwal?.selisih||0)>=1&&(item.stokAwal?.opr||0)!==0;
        else if (selectedKategori === 'produksi')   matchesKategori = Math.abs(item.produksi?.selisih||0)>=1&&(item.produksi?.opr||0)!==0;
        else if (selectedKategori === 'rilis')       matchesKategori = Math.abs(item.rilis?.selisih||0)>=1&&(item.rilis?.opr||0)!==0;
        else if (selectedKategori === 'stok akhir') matchesKategori = Math.abs(item.stokAkhir?.selisih||0)>=1&&(item.stokAkhir?.opr||0)!==0;
      } else {
        matchesKategori = ((Math.abs(item.stokAwal?.selisih||0)>=1&&(item.stokAwal?.opr||0)!==0)||(Math.abs(item.produksi?.selisih||0)>=1&&(item.produksi?.opr||0)!==0)||(Math.abs(item.rilis?.selisih||0)>=1&&(item.rilis?.opr||0)!==0)||(Math.abs(item.stokAkhir?.selisih||0)>=1&&(item.stokAkhir?.opr||0)!==0));
      }
      return matchesSearch && matchesLokasi && matchesFasilitas && matchesKategori && matchesSelisih;
    });
  }, [importedData, searchTerm, selectedLokasi, selectedFasilitas, selectedKategori, selectedSelisih]);

  const handleExport = async () => {
    if (importedData.length > 0) {
      try {
        const exportData = importedData.map(item => ({
          'Material ID': item.materialId || '', 'Material Name': item.materialName || '', 'Location': item.location || '',
          'Stok Awal - OPR': item.stokAwal?.opr??0, 'Stok Awal - SAP': item.stokAwal?.sap??0, 'Stok Awal - Selisih': item.stokAwal?.selisih??0,
          'Produksi - OPR': item.produksi?.opr??0, 'Produksi - SAP': item.produksi?.sap??0, 'Produksi - Selisih': item.produksi?.selisih??0,
          'Rilis - OPR': item.rilis?.opr??0, 'Rilis - SAP': item.rilis?.sap??0, 'Rilis - Selisih': item.rilis?.selisih??0,
          'Stok Akhir - OPR': item.stokAkhir?.opr??0, 'Stok Akhir - SAP': item.stokAkhir?.sap??0, 'Stok Akhir - Selisih': item.stokAkhir?.selisih??0,
        }));
        await exportToExcel(exportData, 'Material_Reconciliation.xlsx');
      } catch (error) { console.error('Export error:', error); toast.error('Gagal export data: ' + error); }
    }
  };

  const handleDataImport = async (data: MaterialData[]) => {
    // Optimistically show the data immediately, then persist in background
    startTransition(() => setImportedData(data));
    try {
      const response = await fetch('/api/material-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (!response.ok) { const err = await response.json(); throw new Error(err.error || 'Failed to save data'); }
      const [result, historyResponse] = await Promise.all([
        response.json(),
        fetch('/api/material-data?action=history'),
      ]);
      if (historyResponse.ok) {
        const dates = await historyResponse.json();
        const sortedDates = dates.sort((a: string, b: string) => new Date(b).getTime() - new Date(a).getTime());
        setHistoryDates(sortedDates);
        if (sortedDates.length > 0) setSelectedDate(sortedDates[0]);
      }
      toast.success('Data berhasil diimport dan disimpan ke database!', { description: `Total: ${result.count} records tersimpan` });
    } catch (error: any) {
      console.error('Error saving to database:', error);
      toast.error('Data berhasil diimport tetapi gagal disimpan ke database', { description: error.message });
    }
  };

  /* ── render ──────────────────────────────────────────────────────── */
  return (
    <div className="flex min-h-screen bg-gray-50">
      {isMobileSidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setIsMobileSidebarOpen(false)} />
      )}
      <div className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ease-in-out ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <Sidebar onClose={() => setIsMobileSidebarOpen(false)} />
      </div>

      <div ref={pageRef} className="flex-1 bg-gray-50 lg:ml-64 overflow-x-hidden">
        <Header title="Laporan Material" onMenuClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)} subtitle="Laporan material terintegrasi dengan SAP" />

        <div className="p-3 sm:p-4 md:p-6 lg:p-8 space-y-4 sm:space-y-6 overflow-x-hidden">

          {/* History Selector */}
          {historyDates.length > 0 && (
            <div ref={historySectionRef} className="bg-white border border-gray-200 rounded-xl p-3 sm:p-4 shadow-sm">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="w-9 h-9 sm:w-10 sm:h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Clock className="text-blue-600" size={18} />
                  </div>
                  <div>
                    <p className="text-xs sm:text-sm font-semibold text-gray-800">Pilih Data Import</p>
                    <p className="text-xs text-gray-400 hidden sm:block">Menampilkan 2 data import terakhir</p>
                  </div>
                </div>
                <select
                  value={selectedDate}
                  onChange={(e) => handleDateChange(e.target.value)}
                  className="w-full sm:w-auto px-3 sm:px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs sm:text-sm bg-white transition-shadow hover:shadow-md"
                >
                  {historyDates.map((date, index) => (
                    <option key={date} value={date}>
                      {new Date(date).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      {index === 0 ? ' (Terbaru)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Excel Import */}
          {canEdit && <ExcelImport onDataImport={handleDataImport} />}

          {/* Loading Skeleton */}
          {isLoading && <LoadingSkeleton />}

          {/* Empty State */}
          {!isLoading && importedData.length === 0 && (
            <div className="bg-blue-50 border-l-4 border-blue-500 rounded-xl p-4 sm:p-6" style={{ animation: 'fadeSlideUp 0.45s cubic-bezier(.22,1,.36,1) both' }}>
              <style jsx>{`@keyframes fadeSlideUp { from { opacity:0; transform:translateY(18px); } to { opacity:1; transform:translateY(0); } }`}</style>
              <div className="flex items-start gap-2 sm:gap-3">
                <AlertCircle className="text-blue-600 flex-shrink-0 mt-0.5" size={20} />
                <div>
                  <h3 className="text-base sm:text-lg font-semibold text-blue-800 mb-1">Import Data Excel</h3>
                  <p className="text-xs sm:text-sm text-blue-700">Silakan import file Excel untuk melihat visualisasi data material dan statistik rekonsiliasi.</p>
                </div>
              </div>
            </div>
          )}

          {/* Data Sections */}
          {importedData.length > 0 && (
            <>
              {/* Header + Metric Cards + Charts */}
              <div ref={statsSectionRef} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                {/* header */}
                <div className="flex flex-col sm:flex-row items-start justify-between p-4 sm:p-6 border-b border-gray-200 bg-gradient-to-r from-red-50 via-orange-50 to-white gap-3 relative overflow-hidden">
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute -top-8 -right-8 w-32 h-32 bg-red-100/40 rounded-full blur-2xl" />
                    <div className="absolute -bottom-6 left-1/3 w-24 h-24 bg-orange-100/30 rounded-full blur-2xl" />
                  </div>
                  <div className="relative z-10">
                    <h2 className="text-lg sm:text-xl md:text-2xl font-extrabold text-red-700 mb-1 tracking-tight">Rekonsiliasi Volume Produksi</h2>
                    <p className="text-xs sm:text-sm text-gray-600 mb-0.5">PT Semen Indonesia (Persero) Tbk</p>
                    <p className="text-xs text-gray-500">Pabrik Tuban &amp; Gresik</p>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline" className="text-[10px] border-red-200 text-red-600 bg-red-50 hover:bg-red-100">{additionalMetrics.totalMaterials} material</Badge>
                      <Badge variant="outline" className="text-[10px] border-orange-200 text-orange-600 bg-orange-50 hover:bg-orange-100">{additionalMetrics.totalLocations} lokasi</Badge>
                    </div>
                  </div>
                  <button
                    ref={exportBtnRef}
                    onClick={handleExport}
                    className="relative z-10 flex items-center gap-1.5 sm:gap-2 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white px-4 sm:px-5 py-2.5 rounded-xl shadow-lg text-xs sm:text-sm font-semibold w-full sm:w-auto justify-center transition-colors active:scale-95"
                  >
                    <Download size={15} className="sm:w-4 sm:h-4" />
                    Export Data
                  </button>
                </div>

                {/* metric cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 p-3 sm:p-4 md:p-6 pb-0">
                  <MetricCardAnimated icon={TrendingDown} label="Total Volume Selisih" value={dynamicStats.totalSelisih} sub={`Dari ${additionalMetrics.totalMaterials} material`} delay={0} />
                  <MetricCardAnimated icon={Package}      label="Total Material"       value={additionalMetrics.totalMaterials} sub="Jenis Material Unik" delay={70} />
                  <MetricCardAnimated icon={MapPin}       label="Total Lokasi"          value={additionalMetrics.totalLocations} sub="Locations" delay={140} />
                  <MetricCardAnimated icon={Calculator}   label="Rata-rata Selisih"     value={additionalMetrics.avgSelisihPerMaterial} sub="Per Material" delay={210} />
                </div>

                {/* charts */}
                <div ref={chartsSectionRef} className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 px-3 sm:px-4 md:px-6 pt-4 sm:pt-5 pb-4 sm:pb-6">
                  {/* per Kategori */}
                  <div className="chart-panel bg-white rounded-xl p-4 sm:p-6 border border-gray-200 shadow-sm hover:shadow-lg transition-shadow duration-300">
                    <div className="flex items-center gap-2 mb-3 sm:mb-4">
                      <div className="w-9 h-9 sm:w-10 sm:h-10 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <FolderOpen className="text-red-600" size={16} />
                      </div>
                      <div>
                        <p className="text-xs sm:text-sm font-bold text-gray-800">Volume Selisih per Kategori</p>
                        <p className="text-xs text-gray-400">4 Kategori Stok</p>
                      </div>
                    </div>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={volumeSelisihPerKategori} layout="vertical" margin={{ left: 0, right: 10 }}>
                        <defs>
                          <linearGradient id="redGrad" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#DC2626" /><stop offset="100%" stopColor="#F97316" />
                          </linearGradient>
                        </defs>
                        <XAxis type="number" hide />
                        <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11, fontWeight: 500 }} tickLine={false} axisLine={false} />
                        <Tooltip formatter={(value) => value ? (value as number).toLocaleString('id-ID') : '0'} contentStyle={{ fontSize: '11px', borderRadius: '10px', border: '1px solid #e5e7eb', boxShadow: '0 4px 16px rgb(0 0 0/.08)' }} />
                        <Bar dataKey="value" fill="url(#redGrad)" radius={[0, 8, 8, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* per Lokasi */}
                  <div className="chart-panel bg-white rounded-xl p-4 sm:p-6 border border-gray-200 shadow-sm hover:shadow-lg transition-shadow duration-300">
                    <div className="flex flex-col sm:flex-row items-start justify-between mb-3 sm:mb-4 gap-2">
                      <div className="flex items-center gap-2">
                        <div className="w-9 h-9 sm:w-10 sm:h-10 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Navigation className="text-red-600" size={16} />
                        </div>
                        <div>
                          <p className="text-xs sm:text-sm font-bold text-gray-800">Volume Selisih per Lokasi</p>
                          <p className="text-xs text-gray-400">Top 10 Tertinggi</p>
                        </div>
                      </div>
                      {additionalMetrics.highestSelisihLocation.location !== 'N/A' && (
                        <div className="flex items-center gap-1.5 bg-red-50 px-2.5 py-1.5 rounded-lg border border-red-100">
                          <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                          <p className="text-[10px] text-red-600 font-semibold">{additionalMetrics.highestSelisihLocation.location.substring(0, 12)}…</p>
                        </div>
                      )}
                    </div>
                    {volumeSelisihPerLokasi.length > 0 ? (
                      <ResponsiveContainer width="100%" height={Math.max(250, volumeSelisihPerLokasi.length * 30)}>
                        <BarChart data={volumeSelisihPerLokasi} layout="vertical" margin={{ left: 0, right: 10 }}>
                          <defs>
                            <linearGradient id="redGrad2" x1="0" y1="0" x2="1" y2="0">
                              <stop offset="0%" stopColor="#DC2626" /><stop offset="100%" stopColor="#F97316" />
                            </linearGradient>
                          </defs>
                          <XAxis type="number" hide />
                          <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10, fontWeight: 500 }} tickLine={false} axisLine={false} />
                          <Tooltip
                            formatter={(value) => value ? (value as number).toLocaleString('id-ID') : '0'}
                            labelFormatter={(label) => { const item = volumeSelisihPerLokasi.find(i => i.name === label); return item?.fullName || label; }}
                            contentStyle={{ fontSize: '11px', borderRadius: '10px', border: '1px solid #e5e7eb', boxShadow: '0 4px 16px rgb(0 0 0/.08)' }}
                          />
                          <Bar dataKey="value" fill="url(#redGrad2)" radius={[0, 8, 8, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="text-xs text-gray-400 text-center py-10">No data available</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Filters */}
              <div ref={filtersSectionRef} className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 shadow-sm">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  <div className="filter-item relative sm:col-span-2 lg:col-span-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={15} />
                    <input
                      type="text" placeholder="Search Material" value={searchInput}
                      onChange={handleSearchChange}
                      className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white shadow-sm text-xs sm:text-sm transition-shadow hover:shadow-md"
                    />
                  </div>
                  <select value={selectedFasilitas} onChange={(e) => setSelectedFasilitas(e.target.value)} className="filter-item px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-white shadow-sm appearance-none cursor-pointer text-xs sm:text-sm transition-shadow hover:shadow-md">
                    <option value="all">fasilitas: all</option>
                    <option value="pabrik">fasilitas: pabrik</option>
                    <option value="gudang">fasilitas: gudang</option>
                  </select>
                  <select value={selectedKategori} onChange={(e) => setSelectedKategori(e.target.value)} className="filter-item px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-white shadow-sm appearance-none cursor-pointer text-xs sm:text-sm transition-shadow hover:shadow-md">
                    <option value="all">kategori: all</option>
                    <option value="stok awal">kategori: stok awal</option>
                    <option value="produksi">kategori: produksi</option>
                    <option value="rilis">kategori: rilis</option>
                    <option value="stok akhir">kategori: stok akhir</option>
                  </select>
                  <select value={selectedSelisih} onChange={(e) => setSelectedSelisih(e.target.value)} className="filter-item px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-white shadow-sm appearance-none cursor-pointer text-xs sm:text-sm transition-shadow hover:shadow-md">
                    <option value="all">selisih: all</option>
                    <option value="ada selisih">selisih: ada selisih</option>
                  </select>
                  <select value={selectedLokasi} onChange={(e) => setSelectedLokasi(e.target.value)} className="filter-item px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-white shadow-sm appearance-none cursor-pointer text-xs sm:text-sm transition-shadow hover:shadow-md">
                    {uniqueLocations.map(l => (<option key={l} value={l}>lokasi: {l === 'All' ? 'all' : l}</option>))}
                  </select>
                </div>
              </div>

              {/* Pivot Table */}
              <div ref={tableSectionRef} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="p-3 sm:p-4 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white flex items-center justify-between">
                  <div>
                    <h3 className="text-base sm:text-lg font-extrabold text-red-600">Perbandingan Stok per Material</h3>
                    <p className="text-xs text-gray-400 mt-0.5">{filteredData.length} item ditampilkan</p>
                  </div>
                  <Badge className="bg-red-50 text-red-600 border border-red-200 text-[11px] font-semibold">{filteredData.length} record</Badge>
                </div>
                <style jsx>{`
                  .custom-scrollbar::-webkit-scrollbar { height: 8px; }
                  .custom-scrollbar::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 5px; }
                  .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 5px; }
                  .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
                `}</style>
                <div className="overflow-x-auto custom-scrollbar" style={{ maxWidth: '100%' }}>
                  <MaterialPivotTable data={filteredData} selectedKategori={selectedKategori} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
