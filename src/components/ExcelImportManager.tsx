import React, { useState, useRef, useEffect } from 'react';
import { FileSpreadsheet, ArrowRight, Loader2, CheckCircle2, AlertTriangle, Merge, Database, ListPlus, RefreshCw, Play, Building2, UploadCloud, ChevronDown } from 'lucide-react';
import { read, utils } from 'xlsx';
import { ExcelVoucher, ProcessedFile } from '../types';
import { generateBulkExcelXml, pushToTally, fetchExistingLedgers, analyzeLedgerRequirements, fetchOpenCompanies } from '../services/tallyService';
import { v4 as uuidv4 } from 'uuid';

interface ExcelImportManagerProps {
    onPushLog: (status: 'Success' | 'Failed', message: string, response?: string) => void;
    onRegisterFile?: (file: File) => string;
    onUpdateFile?: (id: string, updates: Partial<ProcessedFile>) => void;
}

// Precision Helper
const round = (num: number): number => {
    return Math.round((num + Number.EPSILON) * 100) / 100;
};

const ExcelImportManager: React.FC<ExcelImportManagerProps> = ({ onPushLog, onRegisterFile, onUpdateFile }) => {
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [file, setFile] = useState<File | null>(null);
    const [fileId, setFileId] = useState<string | null>(null);
    const [rawData, setRawData] = useState<any[]>([]);
    const [mappedData, setMappedData] = useState<ExcelVoucher[]>([]);
    const [progress, setProgress] = useState({ processed: 0, total: 0, batch: 0, errors: 0 });
    const [isProcessing, setIsProcessing] = useState(false);
    const [missingLedgers, setMissingLedgers] = useState<string[]>([]);
    const [isCheckingLedgers, setIsCheckingLedgers] = useState(false);
    const [connectionError, setConnectionError] = useState<boolean>(false);
    const [companies, setCompanies] = useState<string[]>([]);
    const [selectedCompany, setSelectedCompany] = useState<string>('');
    const [loadingCompanies, setLoadingCompanies] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [allColumns, setAllColumns] = useState<string[]>([]);

    const [mapping, setMapping] = useState({
        voucherType: '',
        date: '',
        invoiceNo: '',
        partyName: '',
        gstin: '',
        amount: '',
        taxRate: '',
        rate: '',
        period: '',
        reverseCharge: '',
        invoiceValue: '',
        taxableValue: '',
        igst: '',
        cgst: '',
        sgst: '',
        cess: '',
        quantity: ''
    });

    const BATCH_SIZE = 100;

    useEffect(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        if (step === 3 && mappedData.length > 0) {
            checkLedgers();
            loadCompanies();
        }
    }, [step, mappedData]);

    const loadCompanies = async () => {
        setLoadingCompanies(true);
        try {
            const list = await fetchOpenCompanies();
            setCompanies(list);
            if (list.length > 0 && !selectedCompany) setSelectedCompany(list[0]);
        } catch (e) {
            console.error("Failed to load companies", e);
        } finally {
            setLoadingCompanies(false);
        }
    };

    const checkLedgers = async () => {
        setIsCheckingLedgers(true);
        setConnectionError(false);
        try {
            const existing = await fetchExistingLedgers(selectedCompany);
            const sample = mappedData.slice(0, 500);
            const missing = analyzeLedgerRequirements(sample, existing);
            setMissingLedgers(missing);
        } catch (e) {
            setConnectionError(true);
        } finally {
            setIsCheckingLedgers(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const f = e.target.files[0];
            setFile(f);
            let currentFileId = onRegisterFile ? onRegisterFile(f) : null;
            setFileId(currentFileId);
            const reader = new FileReader();
            reader.onload = (evt) => {
                const dataBuffer = evt.target?.result;
                if (!dataBuffer) return;
                try {
                    const wb = read(dataBuffer, { type: 'array' });
                    const ws = wb.Sheets[wb.SheetNames[0]];
                    const data = utils.sheet_to_json(ws, { header: 1 }) as any[][];
                    if (data.length > 0) {
                        let headerRowIndex = 0;
                        let maxScore = 0;
                        const keywords = ['date', 'invoice', 'no', 'gstin', 'party', 'name', 'tax', 'amount', 'rate', 'value', 'type', 'ledger', 'cgst', 'sgst', 'igst', 'total'];
                        for (let i = 0; i < Math.min(data.length, 20); i++) {
                            const row = data[i];
                            if (!Array.isArray(row)) continue;
                            let score = 0;
                            row.forEach(cell => { if (typeof cell === 'string' && keywords.some(k => cell.toLowerCase().includes(k))) score++; });
                            if (score > maxScore) { maxScore = score; headerRowIndex = i; }
                        }
                        const header = (data[headerRowIndex] || []).map(String);
                        setAllColumns(header);
                        setRawData(data.slice(headerRowIndex + 1));

                        const guess = { ...mapping };
                        header.forEach(col => {
                            const c = col.toLowerCase().trim();
                            if (c === 'date' || c.includes('inv date') || c.includes('invoice date') || c.includes('bill date') || c.includes('voucher date') || c.includes('vch date')) guess.date = col;
                            if (c === 'inv no' || c === 'invoice no' || c === 'no' || c === 'bill no' || c.includes('voucher no') || c.includes('doc no') || c === 'invoice number' || c === 'vch no') guess.invoiceNo = col;
                            if (c === 'party' || c === 'name' || c.includes('party name') || c.includes('customer') || c.includes('supplier') || c.includes('ledger') || c.includes('particulars')) guess.partyName = col;
                            if (c.includes('gstin') || c.includes('gst no')) guess.gstin = col;

                            if (c.includes('taxable') || c === 'basic' || c === 'assessable value' || (c.includes('amount') && !c.includes('total') && !c.includes('tax') && !c.includes('cgst') && !c.includes('sgst') && !c.includes('igst'))) {
                                if (!guess.amount) guess.amount = col;
                                if (!guess.taxableValue) guess.taxableValue = col;
                            }
                            if ((c.includes('rate') || c.includes('%')) && (c.includes('tax') || c.includes('gst'))) {
                                if (!guess.taxRate) guess.taxRate = col;
                                if (!guess.rate) guess.rate = col;
                            }
                            if (c.includes('qty') || c.includes('quantity') || c.includes('nos') || c.includes('unit')) guess.quantity = col;
                            if (c.includes('total') || c.includes('grand total') || c.includes('invoice val') || c.includes('invoice amt') || c.includes('net amount')) guess.invoiceValue = col;
                            if (c.includes('igst') && !c.includes('rate')) guess.igst = col;
                            if (c.includes('cgst') && !c.includes('rate')) guess.cgst = col;
                            if (c.includes('sgst') && !c.includes('rate')) guess.sgst = col;
                            if (c.includes('cess') && !c.includes('rate')) guess.cess = col;
                            if (c.includes('period')) guess.period = col;
                            if (c.includes('reverse') || c.includes('rcm')) guess.reverseCharge = col;
                        });

                        // Defaults
                        if (!guess.quantity) guess.quantity = 'N/A';
                        // Do NOT default voucherType.
                        guess.voucherType = '';

                        setMapping(guess);
                        setStep(2);
                        if (onUpdateFile && currentFileId) onUpdateFile(currentFileId, { status: 'Processing' });
                    }
                } catch (err) {
                    onPushLog('Failed', 'Excel Parse Error', 'Could not read file.');
                    if (onUpdateFile && currentFileId) onUpdateFile(currentFileId, { status: 'Failed' });
                }
            };
            reader.readAsArrayBuffer(f);
        }
    };

    const processMapping = () => {
        if (!mapping.voucherType) {
            alert("Please select a valid Voucher Type (Sales or Purchase)");
            return;
        }

        const parseNum = (v: any) => {
            if (v === null || v === undefined) return 0;
            if (typeof v === 'string') return parseFloat(v.replace(/,/g, '').replace(/%/g, '')) || 0;
            return Number(v) || 0;
        };

        const flatRows = rawData.map((row: any) => {
            const idx = (colName: string) => allColumns.indexOf(colName);
            const val = (colName: string) => colName && idx(colName) !== -1 ? row[idx(colName)] : null;

            let dateVal: any = val(mapping.date);
            if (typeof dateVal === 'number' || (!isNaN(Number(dateVal)) && Number(dateVal) > 20000)) {
                const date_info = new Date(Math.floor(Number(dateVal) - 25569) * 86400 * 1000);
                dateVal = `${date_info.getFullYear()}-${String(date_info.getMonth() + 1).padStart(2, '0')}-${String(date_info.getDate()).padStart(2, '0')}`;
            } else if (typeof dateVal === 'string') { dateVal = dateVal.trim(); }
            else { dateVal = new Date().toISOString().slice(0, 10); }

            let vType = 'Purchase';
            if (mapping.voucherType === 'Purchase' || mapping.voucherType === 'Sales') {
                vType = mapping.voucherType;
            } else {
                const rowVal = String(val(mapping.voucherType) || '');
                if (rowVal && rowVal.toLowerCase().includes('sale')) vType = 'Sales';
            }

            let qty = 1;
            if (mapping.quantity && mapping.quantity !== 'N/A') {
                qty = parseNum(val(mapping.quantity)) || 1;
            }

            const taxable = parseNum(val(mapping.amount) || val(mapping.taxableValue));
            const rate = parseNum(val(mapping.taxRate) || val(mapping.rate));
            const total = parseNum(val(mapping.invoiceValue));

            return {
                date: String(dateVal),
                invoiceNo: String(val(mapping.invoiceNo) || '').trim(),
                partyName: String(val(mapping.partyName) || 'Cash').trim(),
                gstin: String(val(mapping.gstin) || '').trim(),
                amount: taxable,
                taxRate: rate,
                totalAmount: total,
                voucherType: vType as 'Sales' | 'Purchase',
                quantity: qty,
                igst: parseNum(val(mapping.igst)),
                cgst: parseNum(val(mapping.cgst)),
                sgst: parseNum(val(mapping.sgst)),
                cess: parseNum(val(mapping.cess)),
                period: String(val(mapping.period) || ''),
                reverseCharge: String(val(mapping.reverseCharge) || '')
            };
        }).filter(t => (t.amount !== 0 || t.totalAmount !== 0) && t.invoiceNo !== '');

        const groupedMap = new Map<string, ExcelVoucher>();
        flatRows.forEach(row => {
            const key = `${row.invoiceNo.toLowerCase()}_${row.partyName.toLowerCase()}_${row.date}`;
            if (!groupedMap.has(key)) {
                groupedMap.set(key, {
                    id: uuidv4(), date: row.date, invoiceNo: row.invoiceNo, partyName: row.partyName,
                    gstin: row.gstin, voucherType: row.voucherType, items: [], totalAmount: 0,
                    period: row.period,
                    reverseCharge: row.reverseCharge
                });
            }
            const v = groupedMap.get(key)!;
            v.items.push({
                amount: row.amount,
                taxRate: row.taxRate,
                quantity: row.quantity,
                igst: row.igst,
                cgst: row.cgst,
                sgst: row.sgst,
                cess: row.cess
            });
            const lineTotal = row.amount + (row.igst || 0) + (row.cgst || 0) + (row.sgst || 0) + (row.cess || 0);
            v.totalAmount = round(v.totalAmount + (row.totalAmount > 0 ? row.totalAmount : lineTotal));
        });

        const vouchers = Array.from(groupedMap.values());
        setMappedData(vouchers);
        setProgress({ processed: 0, total: vouchers.length, batch: 0, errors: 0 });
        setStep(3);
        if (onUpdateFile && fileId) onUpdateFile(fileId, { status: 'Ready', correctEntries: vouchers.length });
    };

    const startBulkPush = async () => {
        setIsProcessing(true);
        if (onUpdateFile && fileId) onUpdateFile(fileId, { status: 'Processing' });
        try {
            const total = mappedData.length;
            const totalBatches = Math.ceil(total / BATCH_SIZE);
            let createdMasters = new Set<string>();
            try { const existing = await fetchExistingLedgers(selectedCompany); createdMasters = new Set(existing); } catch { }
            let errorCount = 0;
            for (let i = 0; i < totalBatches; i++) {
                const end = (i + 1) * BATCH_SIZE;
                const batch = mappedData.slice(i * BATCH_SIZE, end);
                const xml = generateBulkExcelXml(batch, createdMasters, selectedCompany);
                const result = await pushToTally(xml);
                if (!result.success) errorCount += batch.length;
                setProgress({ processed: Math.min(end, total), total, batch: i + 1, errors: errorCount });
                await new Promise(r => setTimeout(r, 100));
            }
            if (errorCount > 0) {
                onPushLog('Failed', 'Bulk Import with Errors', `Finished with ${errorCount} failures.`);
                if (onUpdateFile && fileId) onUpdateFile(fileId, { status: 'Failed' });
            } else {
                onPushLog('Success', 'Bulk Import Complete', `Successfully pushed ${total} merged vouchers.`);
                if (onUpdateFile && fileId) onUpdateFile(fileId, { status: 'Success' });
            }
        } catch (e) {
            onPushLog('Failed', 'Bulk Import Error', 'An error occurred during push.');
        } finally { setIsProcessing(false); }
    };

    const visibleColumns = allColumns.filter(col => col);
    const pct = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;

    if (step === 1) {
        return (
            <div className="flex flex-col h-full gap-6 animate-fade-in relative transition-colors overflow-hidden">
                <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-xl flex items-center justify-center shadow-inner">
                            <FileSpreadsheet className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white uppercase tracking-tight">Excel Bulk Import</h2>
                            <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">Reconcile large volume spreadsheet data efficiently</p>
                        </div>
                    </div>
                </div>

                <div className="flex-1 flex flex-col items-center justify-center bg-white dark:bg-slate-800 rounded-[32px] border-4 border-dashed border-slate-200 dark:border-slate-700 p-16 shadow-sm group">
                    <div className="w-24 h-24 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-500 rounded-full flex items-center justify-center mb-8 shadow-inner transition-transform group-hover:scale-110 duration-500">
                        <UploadCloud className="w-12 h-12" />
                    </div>
                    <div className="text-center space-y-6 max-w-lg">
                        <h3 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Drop Excel Spreadsheet</h3>
                        <p className="text-slate-500 dark:text-slate-400 font-medium leading-relaxed">Select a .xlsx or .csv file. We'll help you map the columns to Tally vouchers next.</p>
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white px-10 py-4 rounded-2xl font-black text-lg shadow-xl shadow-emerald-600/20 transition-all hover:-translate-y-1 active:scale-95 flex items-center gap-3 mx-auto"
                        >
                            Select Spreadsheet
                            <ArrowRight className="w-5 h-5" />
                        </button>
                        <input ref={fileInputRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={handleFileUpload} />
                    </div>
                </div>
            </div>
        );
    }

    if (step === 2) {
        return (
            <div className="flex-1 p-6 flex flex-col gap-6 animate-fade-in overflow-hidden">
                <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="font-bold text-lg flex items-center gap-2 text-slate-900 dark:text-white">
                            <Database className="w-5 h-5 text-indigo-500" />
                            Map Columns
                        </h3>
                        <span className="text-xs px-2 py-1 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 rounded-lg">
                            Detected {allColumns.length} columns (Filtered)
                        </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {/* Special Handling for VoucherType logic: If it's standard dropdown */}
                        <div>
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 pl-1">voucher type *</label>
                            <div className="relative group">
                                <select
                                    value={mapping.voucherType}
                                    onChange={(e) => setMapping({ ...mapping, voucherType: e.target.value })}
                                    className="w-full px-5 py-3.5 border-2 border-slate-100 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 rounded-2xl bg-slate-50/50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm font-bold appearance-none cursor-pointer outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all shadow-sm"
                                >
                                    <option value="">-- Select Type --</option>
                                    <option value="Purchase">Purchase</option>
                                    <option value="Sales">Sales</option>
                                </select>
                                <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none group-hover:text-indigo-500 transition-colors" />
                            </div>
                        </div>

                        {/* Loop for other fields */}
                        {Object.keys(mapping).filter(key => key !== 'voucherType' && key !== 'quantity').map(key => (
                            <div key={key}>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 pl-1">{key}</label>
                                <div className="relative group">
                                    <select
                                        value={mapping[key as keyof typeof mapping]}
                                        onChange={(e) => setMapping({ ...mapping, [key as keyof typeof mapping]: e.target.value })}
                                        className="w-full px-5 py-3.5 border-2 border-slate-100 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 rounded-2xl bg-slate-50/50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm font-bold appearance-none cursor-pointer outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all shadow-sm"
                                    >
                                        <option value="">Select Column</option>
                                        {visibleColumns.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none group-hover:text-indigo-500 transition-colors" />
                                </div>
                            </div>
                        ))}

                        {/* Quantity Last */}
                        <div>
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 pl-1">quantity</label>
                            <div className="relative group">
                                <select
                                    value={mapping.quantity}
                                    onChange={(e) => setMapping({ ...mapping, quantity: e.target.value })}
                                    className="w-full px-5 py-3.5 border-2 border-slate-100 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 rounded-2xl bg-slate-50/50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm font-bold appearance-none cursor-pointer outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all shadow-sm"
                                >
                                    <option value="">Select Column</option>
                                    <option value="N/A">N/A (No Quantity)</option>
                                    {visibleColumns.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                                <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none group-hover:text-indigo-500 transition-colors" />
                            </div>
                        </div>
                    </div>

                    <div className="mt-8 flex justify-end gap-3">
                        <button onClick={() => setStep(1)} className="px-6 py-3 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold transition-all">Cancel</button>
                        <button
                            onClick={processMapping}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 shadow-xl shadow-indigo-600/20 active:scale-95 transition-all outline-none focus:ring-4 focus:ring-indigo-500/20"
                        >
                            Next <ArrowRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                <div className="flex-1 bg-white dark:bg-slate-800 rounded-[32px] border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm flex flex-col">
                    <div className="p-6 bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                        <span className="font-black text-xs text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                            Preview (First 5 Rows)
                        </span>
                    </div>
                    <div className="overflow-auto flex-1">
                        <table className="w-full text-sm text-left whitespace-nowrap">
                            <thead className="bg-white dark:bg-slate-800 text-slate-400 border-b border-slate-100 dark:border-slate-700/50 sticky top-0 z-10 shadow-sm">
                                <tr>
                                    {visibleColumns.map((c, i) => <th key={i} className="px-6 py-4 font-black uppercase tracking-wider text-[10px]">{c}</th>)}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {rawData.slice(0, 5).map((row, i) => (
                                    <tr key={i} className="group hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                                        {visibleColumns.map((colName, j) => {
                                            const idx = allColumns.indexOf(colName);
                                            return (
                                                <td key={j} className="px-6 py-4 text-slate-600 dark:text-slate-300 font-medium group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
                                                    {row[idx]}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col gap-6 animate-fade-in h-full overflow-hidden">
            <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex justify-between items-center transition-colors shrink-0">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center shadow-inner">
                        <Merge className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white uppercase">Review & Import</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">{mappedData.length} Merged Vouchers Ready</p>
                    </div>
                </div>

                {!isProcessing && progress.processed === 0 && (
                    <button onClick={startBulkPush} disabled={connectionError} className="bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-2.5 rounded-xl font-black shadow-lg shadow-emerald-600/20 transition-all flex items-center gap-2 active:scale-95">
                        <Play className="w-5 h-5" />
                        Push to Tally
                    </button>
                )}
            </div>

            <div className="flex-1 flex flex-col gap-6 overflow-y-auto pr-2 scrollbar-thin scroll-smooth">
                <div className="w-full bg-white dark:bg-slate-800 rounded-[40px] border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col items-center justify-center p-16 text-center relative overflow-hidden shrink-0 transition-colors">
                    {isProcessing && (
                        <div className="animate-fade-in">
                            <div className="mb-10 relative w-32 h-32 mx-auto">
                                <svg className="w-full h-full transform -rotate-90">
                                    <circle cx="64" cy="64" r="56" stroke="currentColor" strokeWidth="10" fill="transparent" className="text-slate-100 dark:text-slate-900" />
                                    <circle cx="64" cy="64" r="56" stroke="currentColor" strokeWidth="10" fill="transparent" className="text-indigo-600 transition-all duration-300" strokeDasharray="351.8" strokeDashoffset={351.8 - (351.8 * pct) / 100} strokeLinecap="round" />
                                </svg>
                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                    <span className="text-3xl font-black text-indigo-600 dark:text-indigo-500">{pct}%</span>
                                </div>
                            </div>
                            <h2 className="text-3xl font-black text-slate-900 dark:text-white mb-3 tracking-tight">Syncing with Tally...</h2>
                            <p className="text-slate-500 dark:text-slate-400 font-mono font-bold">Progress: {progress.processed} / {progress.total} Entries</p>
                        </div>
                    )}
                    {!isProcessing && progress.processed > 0 && (
                        <div className="animate-fade-in">
                            <div className="w-24 h-24 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 rounded-[32px] flex items-center justify-center mx-auto mb-8 shadow-inner"><CheckCircle2 className="w-12 h-12" /></div>
                            <h2 className="text-4xl font-black text-slate-900 dark:text-white mb-4 tracking-tight uppercase">Import Successful</h2>
                            <p className="text-slate-500 dark:text-slate-400 font-medium mb-10 leading-relaxed">Successfully synchronized {progress.total} vouchers with Tally Prime.</p>
                            <button onClick={() => setStep(1)} className="bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 dark:hover:bg-slate-600 text-white px-12 py-4 rounded-[20px] font-black shadow-xl active:scale-95 transition-all">
                                New Bulk Task
                            </button>
                        </div>
                    )}
                    {!isProcessing && progress.processed === 0 && (
                        <div className="animate-fade-in max-w-md w-full">
                            <div className="text-left bg-slate-50 dark:bg-slate-950 p-8 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-inner">
                                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <Building2 className="w-4 h-4 text-indigo-500" />
                                    Destination Tally Company
                                </label>
                                <div className="flex gap-3">
                                    <select value={selectedCompany} onChange={(e) => setSelectedCompany(e.target.value)} className="flex-1 px-5 py-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-slate-900 dark:text-white text-sm font-bold focus:ring-2 focus:ring-indigo-500 transition-all outline-none">
                                        <option value="">-- Active Company --</option>
                                        {companies.map(c => (<option key={c} value={c}>{c}</option>))}
                                    </select>
                                    <button onClick={loadCompanies} disabled={loadingCompanies} className="p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-400 transition-all active:scale-95 shadow-sm">
                                        <RefreshCw className={`w-5 h-5 ${loadingCompanies ? 'animate-spin' : ''}`} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex-1 w-full flex flex-col bg-white dark:bg-slate-800 rounded-[32px] border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden min-h-[350px] transition-colors">
                    <div className="p-6 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center shrink-0">
                        <h3 className="font-black text-xs text-slate-800 dark:text-white flex items-center gap-3 uppercase tracking-widest">
                            <ListPlus className="w-5 h-5 text-orange-500" />
                            Ledger Verification Gap
                        </h3>
                    </div>
                    <div className="flex-1 overflow-y-auto p-8 space-y-3 min-h-0">
                        {connectionError ? (
                            <div className="h-full flex flex-col items-center justify-center text-red-500 text-center gap-4 py-12">
                                <AlertTriangle className="w-12 h-12 opacity-30" />
                                <p className="font-bold">Sync required for gap analysis.</p>
                            </div>
                        ) : (
                            <>
                                {missingLedgers.length === 0 && !isCheckingLedgers && (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-400 py-12 gap-4">
                                        <CheckCircle2 className="w-16 h-16 opacity-10" />
                                        <p className="font-bold">No missing masters found. Ready to push.</p>
                                    </div>
                                )}
                                {missingLedgers.map((ledger, idx) => (
                                    <div key={idx} className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl transition-all">
                                        <div className="w-2.5 h-2.5 bg-orange-500 rounded-full shadow-[0_0_8px_rgba(249,115,22,0.4)]"></div>
                                        <div className="flex-1">
                                            <p className="text-slate-800 dark:text-white font-bold text-sm">{ledger}</p>
                                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Type: Accounting Master</p>
                                        </div>
                                        <span className="text-[10px] font-black text-slate-300 dark:text-slate-600">AUTO-CREATE ENABLED</span>
                                    </div>
                                ))}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ExcelImportManager;
