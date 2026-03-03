'use client';

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface MaterialData {
  materialId: string;
  materialName: string;
  location: string;
  stokAwal: {
    opr: number;
    sap: number;
    selisih: number;
    total: number;
  };
  produksi: {
    opr: number;
    sap: number;
    selisih: number;
    total: number;
  };
  rilis: {
    opr: number;
    sap: number;
    selisih: number;
    total: number;
  };
  stokAkhir: {
    opr: number;
    sap: number;
    selisih: number;
    total: number;
  };
  blank: number;
  blankTotal: number;
  grandTotal: number;
}

interface MaterialPivotTableProps {
  data: MaterialData[];
  selectedKategori?: string;
}

const PAGE_SIZE = 40; // materials per page – keeps DOM nodes manageable

export default React.memo(function MaterialPivotTable({ data, selectedKategori = 'all' }: MaterialPivotTableProps) {
  const [page, setPage] = useState(1);

  // Reset to first page whenever data or filter changes
  useEffect(() => { setPage(1); }, [data, selectedKategori]);

  if (!data || data.length === 0) {
    return (
      <div className="bg-white rounded-lg p-8 border border-gray-200">
        <p className="text-center text-gray-500">Tidak ada data untuk ditampilkan. Silakan import file Excel terlebih dahulu.</p>
      </div>
    );
  }

  // Which categories to show
  const showStokAwal  = selectedKategori === 'all' || selectedKategori === 'stok awal';
  const showProduksi  = selectedKategori === 'all' || selectedKategori === 'produksi';
  const showRilis     = selectedKategori === 'all' || selectedKategori === 'rilis';
  const showStokAkhir = selectedKategori === 'all' || selectedKategori === 'stok akhir';

  // Memoize grouped data so it doesn't recompute on every render
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const groupedData = useMemo(() =>
    data.reduce((acc, item) => {
      if (!acc[item.materialId]) {
        acc[item.materialId] = { materialId: item.materialId, materialName: item.materialName, locations: [] };
      }
      acc[item.materialId].locations.push(item);
      return acc;
    }, {} as Record<string, { materialId: string; materialName: string; locations: MaterialData[] }>),
  [data]);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const allMaterials = useMemo(() => Object.values(groupedData), [groupedData]);
  const totalPages   = Math.ceil(allMaterials.length / PAGE_SIZE);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const pagedMaterials = useMemo(() =>
    allMaterials.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
  [allMaterials, page]);

  const colSpan = (showStokAwal ? 3 : 0) + (showProduksi ? 3 : 0) + (showRilis ? 3 : 0) + (showStokAkhir ? 3 : 0);

  const formatNumber = (num: number) => {
    if (num === 0) return '0.0';
    return num.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  };

  const getCellClass = (value: number) => {
    if (value < 0) return 'text-red-600 font-medium';
    if (value > 0) return 'text-green-600 font-medium';
    return 'text-black';
  };

  const formatSelisih = (selisih: number, sap: number, applyFilter = true) => {
    if (!applyFilter) return formatNumber(selisih);
    if (sap === 0) return selisih !== 0 ? formatNumber(selisih) : '-';
    return Math.abs((selisih / sap) * 100) > 5 ? formatNumber(selisih) : '-';
  };

  return (
    <div className="overflow-hidden">
      {/* Table */}
      <div className="overflow-x-auto w-full relative" style={{ maxHeight: '600px', overflowY: 'auto' }}>
        <table className="text-xs border-collapse w-full">
          <thead className="bg-gray-100 border-b-2 border-gray-300" style={{ position: 'sticky', top: 0, zIndex: 60 }}>
            <tr style={{ backgroundColor: '#f3f4f6' }}>
              <th rowSpan={2} style={{ 
                position: 'sticky', 
                left: 0, 
                zIndex: 70,
                minWidth: '180px',
                maxWidth: '180px',
                width: '180px',
                backgroundColor: '#f3f4f6',
                boxShadow: '4px 0 8px rgba(0,0,0,0.1)'
              }} className="px-2 py-2 text-left font-semibold text-black border-r-2 border-gray-400">
                Row Labels
              </th>
              {showStokAwal && (
                <th colSpan={3} className="px-1 py-1.5 text-center font-semibold text-black border-r border-gray-300 bg-blue-50 whitespace-nowrap text-xs">
                  1 - Stok Awal
                </th>
              )}
              {showProduksi && (
                <th colSpan={3} className="px-1 py-1.5 text-center font-semibold text-black border-r border-gray-300 bg-green-50 whitespace-nowrap text-xs">
                  2 - Produksi
                </th>
              )}
              {showRilis && (
                <th colSpan={3} className="px-1 py-1.5 text-center font-semibold text-black border-r border-gray-300 bg-yellow-50 whitespace-nowrap text-xs">
                  3 - Rilis
                </th>
              )}
              {showStokAkhir && (
                <th colSpan={3} className="px-1 py-1.5 text-center font-semibold text-black border-r border-gray-300 bg-purple-50 whitespace-nowrap text-xs">
                  4 - Stok Akhir
                </th>
              )}
            </tr>
            <tr style={{ backgroundColor: '#f3f4f6' }}>
              {/* Stok Awal */}
              {showStokAwal && (
                <>
                  <th className="px-1 py-1.5 text-center font-medium text-black border-r border-gray-200 bg-blue-50 whitespace-nowrap text-xs">OPR</th>
                  <th className="px-1 py-1.5 text-center font-medium text-black border-r border-gray-200 bg-blue-50 whitespace-nowrap text-xs">SAP</th>
                  <th className="px-1 py-1.5 text-center font-medium text-black border-r border-gray-300 bg-blue-50 whitespace-nowrap text-xs">Selisih</th>
                </>
              )}
              {/* Produksi */}
              {showProduksi && (
                <>
                  <th className="px-1 py-1.5 text-center font-medium text-black border-r border-gray-200 bg-green-50 whitespace-nowrap text-xs">OPR</th>
                  <th className="px-1 py-1.5 text-center font-medium text-black border-r border-gray-200 bg-green-50 whitespace-nowrap text-xs">SAP</th>
                  <th className="px-1 py-1.5 text-center font-medium text-black border-r border-gray-300 bg-green-50 whitespace-nowrap text-xs">Selisih</th>
                </>
              )}
              {/* Rilis */}
              {showRilis && (
                <>
                  <th className="px-1 py-1.5 text-center font-medium text-black border-r border-gray-200 bg-yellow-50 whitespace-nowrap text-xs">OPR</th>
                  <th className="px-1 py-1.5 text-center font-medium text-black border-r border-gray-200 bg-yellow-50 whitespace-nowrap text-xs">SAP</th>
                  <th className="px-1 py-1.5 text-center font-medium text-black border-r border-gray-300 bg-yellow-50 whitespace-nowrap text-xs">Selisih</th>
                </>
              )}
              {/* Stok Akhir */}
              {showStokAkhir && (
                <>
                  <th className="px-1 py-1.5 text-center font-medium text-black border-r border-gray-200 bg-purple-50 whitespace-nowrap text-xs">OPR</th>
                  <th className="px-1 py-1.5 text-center font-medium text-black border-r border-gray-200 bg-purple-50 whitespace-nowrap text-xs">SAP</th>
                  <th className="px-1 py-1.5 text-center font-medium text-black border-r border-gray-300 bg-purple-50 whitespace-nowrap text-xs">Selisih</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {pagedMaterials.map((material, idx) => (
              <React.Fragment key={material.materialId ?? idx}>
                {/* Material Header Row - Fixed to only first column */}
                <tr className="bg-orange-50 border-t border-b-2 border-gray-400">
                  <td style={{
                    position: 'sticky',
                    left: 0,
                    zIndex: 40,
                    minWidth: '180px',
                    maxWidth: '180px',
                    width: '180px',
                    backgroundColor: '#fff7ed',
                    boxShadow: '4px 0 8px rgba(0,0,0,0.15)',
                    fontWeight: 'bold'
                  }} className="px-2 py-2 text-black text-xs border-r-2 border-gray-500">
                    {material.materialId} | {material.materialName}
                  </td>
                  {/* Empty cells for other columns to maintain table structure */}
                  <td colSpan={colSpan} className="bg-orange-50"></td>
                </tr>
                {/* Location Rows */}
                {material.locations.map((loc, locIdx) => (
                  <tr key={locIdx} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                    <td style={{
                      position: 'sticky',
                      left: 0,
                      zIndex: 30,
                      minWidth: '180px',
                      maxWidth: '180px',
                      width: '180px',
                      backgroundColor: 'white',
                      boxShadow: '4px 0 8px rgba(0,0,0,0.08)'
                    }} className="px-2 py-1.5 text-black border-r-2 border-gray-400 pl-4 text-xs hover:bg-gray-50">
                      {loc.location}
                    </td>
                    {/* Stok Awal */}
                    {showStokAwal && (
                      <>
                        <td className="px-1 py-1.5 text-right border-r border-gray-200 whitespace-nowrap text-black text-xs">{formatNumber(loc.stokAwal.opr)}</td>
                        <td className="px-1 py-1.5 text-right border-r border-gray-200 whitespace-nowrap text-black text-xs">{formatNumber(loc.stokAwal.sap)}</td>
                        <td className={`px-1 py-1.5 text-right border-r border-gray-300 whitespace-nowrap text-xs ${getCellClass(loc.stokAwal.selisih)}`}>
                          {formatSelisih(loc.stokAwal.selisih, loc.stokAwal.sap)}
                        </td>
                      </>
                    )}
                    {/* Produksi */}
                    {showProduksi && (
                      <>
                        <td className="px-1 py-1.5 text-right border-r border-gray-200 whitespace-nowrap text-black text-xs">{formatNumber(loc.produksi.opr)}</td>
                        <td className="px-1 py-1.5 text-right border-r border-gray-200 whitespace-nowrap text-black text-xs">{formatNumber(loc.produksi.sap)}</td>
                        <td className={`px-1 py-1.5 text-right border-r border-gray-300 whitespace-nowrap text-xs ${getCellClass(loc.produksi.selisih)}`}>
                          {formatSelisih(loc.produksi.selisih, loc.produksi.sap, false)}
                        </td>
                      </>
                    )}
                    {/* Rilis */}
                    {showRilis && (
                      <>
                        <td className="px-1 py-1.5 text-right border-r border-gray-200 whitespace-nowrap text-black text-xs">{formatNumber(loc.rilis.opr)}</td>
                        <td className="px-1 py-1.5 text-right border-r border-gray-200 whitespace-nowrap text-black text-xs">{formatNumber(loc.rilis.sap)}</td>
                        <td className={`px-1 py-1.5 text-right border-r border-gray-300 whitespace-nowrap text-xs ${getCellClass(loc.rilis.selisih)}`}>
                          {formatSelisih(loc.rilis.selisih, loc.rilis.sap, false)}
                        </td>
                      </>
                    )}
                    {/* Stok Akhir */}
                    {showStokAkhir && (
                      <>
                        <td className="px-1 py-1.5 text-right border-r border-gray-200 whitespace-nowrap text-black text-xs">{formatNumber(loc.stokAkhir.opr)}</td>
                        <td className="px-1 py-1.5 text-right border-r border-gray-200 whitespace-nowrap text-black text-xs">{formatNumber(loc.stokAkhir.sap)}</td>
                        <td className={`px-1 py-1.5 text-right border-r border-gray-300 whitespace-nowrap text-xs ${getCellClass(loc.stokAkhir.selisih)}`}>
                          {formatSelisih(loc.stokAkhir.selisih, loc.stokAkhir.sap)}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
          <p className="text-xs text-gray-500">
            Halaman <span className="font-semibold text-gray-700">{page}</span> dari{' '}
            <span className="font-semibold text-gray-700">{totalPages}</span>
            &nbsp;&middot;&nbsp;
            {allMaterials.length} material total
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={13} /> Prev
            </button>

            {/* Page number pills */}
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let p: number;
              if (totalPages <= 7) {
                p = i + 1;
              } else if (page <= 4) {
                p = i + 1;
              } else if (page >= totalPages - 3) {
                p = totalPages - 6 + i;
              } else {
                p = page - 3 + i;
              }
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-7 h-7 text-xs rounded-lg font-medium transition-colors ${
                    p === page
                      ? 'bg-red-600 text-white border border-red-600'
                      : 'border border-gray-300 bg-white hover:bg-gray-50 text-gray-700'
                  }`}
                >
                  {p}
                </button>
              );
            })}

            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}, (prev, next) => prev.data === next.data && prev.selectedKategori === next.selectedKategori);
