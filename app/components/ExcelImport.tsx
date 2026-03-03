'use client';

import { toast } from 'sonner';
import { useState, useRef } from 'react';
import { Upload, FileSpreadsheet, X } from 'lucide-react';

// Lazy load XLSX on demand
let XLSX: any = null;
const loadXLSX = async () => {
  if (!XLSX) {
    XLSX = await import('xlsx');
  }
  return XLSX;
};

interface ExcelImportProps {
  onDataImport: (data: any[]) => void;
}

export default function ExcelImport({ onDataImport }: ExcelImportProps) {
  const [fileName, setFileName] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setFileName(file.name);

    try {
      // Load XLSX library on demand
      const XLSXLib = await loadXLSX();
      
      const data = await file.arrayBuffer();
      const workbook = XLSXLib.read(data);
      
      // Look for "Pivot" sheet specifically
      let sheetName = 'Pivot';
      if (!workbook.SheetNames.includes('Pivot')) {
        // Try case-insensitive search
        const pivotSheet = workbook.SheetNames.find((name: string) => 
          name.toLowerCase() === 'pivot'
        );
        
        if (pivotSheet) {
          sheetName = pivotSheet;
        } else {
          toast.error('Sheet "Pivot" tidak ditemukan dalam file Excel. Sheets yang tersedia: ' + workbook.SheetNames.join(', '));
          setIsProcessing(false);
          setFileName('');
          return;
        }
      }
      
      console.log('Reading sheet:', sheetName);
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSXLib.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

      // Process the data
      const processedData = processExcelData(jsonData);
      
      if (processedData.length === 0) {
        toast.success('Tidak ada data yang berhasil diproses. Silakan periksa format file Excel.');
        setFileName('');
      } else {
        onDataImport(processedData);
        console.log(`Berhasil memproses ${processedData.length} baris data dari sheet Pivot`);
      }
    } catch (error) {
      console.error('Error processing file:', error);
      toast.error('Terjadi kesalahan saat membaca file Excel: ' + (error as Error).message);
      setFileName('');
    } finally {
      setIsProcessing(false);
    }
  };

  const processExcelData = (rawData: any[]): any[] => {
    console.log('Raw Excel Data rows:', rawData.length);
    console.log('First 10 rows:', rawData.slice(0, 10));
    
    const processed: any[] = [];
    let currentMaterialId = '';
    let currentMaterialName = '';
    
    // Find the header row (looking for "Column Labels" or "Row Labels")
    let dataStartIndex = -1;
    for (let i = 0; i < Math.min(20, rawData.length); i++) {
      const row = rawData[i];
      if (row && row[0]) {
        const cellValue = row[0].toString().toLowerCase();
        if (cellValue.includes('row labels') || cellValue === 'row labels') {
          dataStartIndex = i + 1; // Data starts after this row
          console.log('Found header at row:', i);
          break;
        }
      }
    }
    
    if (dataStartIndex === -1) {
      console.warn('Header not found, starting from row 3');
      dataStartIndex = 3;
    }
    
    // Process data rows
    for (let i = dataStartIndex; i < rawData.length; i++) {
      const row = rawData[i];
      
      // Skip empty rows
      if (!row || !row[0] || row[0] === '') continue;
      
      const firstCell = row[0].toString().trim();
      
      // Skip (blank) rows and total rows
      if (firstCell.toLowerCase().includes('(blank)') ||
          firstCell.toLowerCase().includes('grand total') ||
          firstCell === '0' ||
          firstCell === '') {
        continue;
      }
      
      // Check if this is a material header row (format: "CODE | NAME")
      if (firstCell.includes('|')) {
        const parts = firstCell.split('|');
        currentMaterialId = parts[0]?.trim() || '';
        currentMaterialName = parts.slice(1).join('|').trim() || '';
        console.log('Found material:', currentMaterialId, currentMaterialName);
        continue;
      }
      
      // This is a location/facility detail row
      const location = firstCell;
      
      // Parse numeric values safely
      const parseValue = (val: any): number => {
        if (val === null || val === undefined || val === '' || val === '-') return 0;
        const parsed = parseFloat(val.toString().replace(/,/g, ''));
        return isNaN(parsed) ? 0 : parsed;
      };
      
      // Based on the Excel image structure, mapping columns:
      // After "Row Labels", we have groups: Stok Awal, Produksi, Rilis, Stok Akhir
      // Each group has: OPR, SAP, Selisih, Total (but in image I see OPR, SAP, Selisih without explicit total column for each)
      
      // Looking at the image more carefully:
      // Col A (0): Row Labels
      // Col B (1): 1 - Stok Awal OPR
      // Col C (2): SAP
      // Col D (3): Selisih
      // Col E (4): 1 - Stok Awal Total
      // Col F (5): 2 - Produksi OPR
      // Col G (6): SAP
      // Col H (7): Selisih
      // ...and so on
      
      const dataRow = {
        materialId: currentMaterialId,
        materialName: currentMaterialName,
        location: location,
        stokAwal: {
          opr: parseValue(row[1]),
          sap: parseValue(row[2]),
          selisih: parseValue(row[3]),
          total: parseValue(row[4]),
        },
        produksi: {
          opr: parseValue(row[5]),
          sap: parseValue(row[6]),
          selisih: parseValue(row[7]),
          total: parseValue(row[8]),
        },
        rilis: {
          opr: parseValue(row[9]),
          sap: parseValue(row[10]),
          selisih: parseValue(row[11]),
          total: parseValue(row[12]),
        },
        stokAkhir: {
          opr: parseValue(row[13]),
          sap: parseValue(row[14]),
          selisih: parseValue(row[15]),
          total: parseValue(row[16]),
        },
        blank: parseValue(row[17]),
        blankTotal: parseValue(row[18]),
        grandTotal: parseValue(row[19]),
      };
      
      // Only add if we have a valid material ID
      if (currentMaterialId) {
        processed.push(dataRow);
      }
    }
    
    console.log('Total processed items:', processed.length);
    console.log('Sample processed data:', processed.slice(0, 3));
    
    return processed;
  };

  const handleClearFile = () => {
    setFileName('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="bg-white rounded-lg p-6 border border-gray-200">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="text-green-600" size={24} />
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Import Data Excel</h3>
            <p className="text-sm text-gray-600">Upload file Excel untuk memvisualisasikan data material</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {!fileName ? (
          <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-green-500 hover:bg-green-50 transition-colors">
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              <Upload className="text-gray-400 mb-2" size={32} />
              <p className="mb-2 text-sm text-gray-500">
                <span className="font-semibold">Klik untuk upload</span> atau drag & drop
              </p>
              <p className="text-xs text-gray-500">Excel file (.xlsx, .xls)</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".xlsx,.xls"
              onChange={handleFileUpload}
              disabled={isProcessing}
            />
          </label>
        ) : (
          <div className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="text-green-600" size={20} />
              <div>
                <p className="text-sm font-medium text-gray-800">{fileName}</p>
                {isProcessing ? (
                  <p className="text-xs text-gray-600">Memproses file...</p>
                ) : (
                  <p className="text-xs text-green-600">File berhasil diupload</p>
                )}
              </div>
            </div>
            <button
              onClick={handleClearFile}
              className="text-gray-500 hover:text-red-600 transition-colors"
              disabled={isProcessing}
            >
              <X size={20} />
            </button>
          </div>
        )}

        {isProcessing && (
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
          </div>
        )}
      </div>
    </div>
  );
}
