
import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, FileText, ArrowRight, Loader2, CheckCircle2, AlertTriangle, Trash2, Landmark, Save, History, Building2, RefreshCw, Database } from 'lucide-react';
import { BankStatementData, BankTransaction, ProcessedFile } from '../types';
import { parseBankStatementWithGemini } from '../services/geminiService';
import { generateBankStatementXml, pushToTally, fetchExistingLedgers, fetchOpenCompanies, getLedgersFromCache, getCompaniesFromCache } from '../services/tallyService';
import { BACKEND_API_KEY } from '../constants';
import { v4 as uuidv4 } from 'uuid';

interface BankStatementManagerProps {
  onPushLog: (status: 'Success' | 'Failed', message: string, response?: string) => void;
  externalFile?: File | null;
  onRedirectToInvoice?: (file: File) => void;
  onRegisterFile?: (file: File) => string;
  onUpdateFile?: (id: string, updates: Partial<ProcessedFile>) => void;
}

const BankStatementManager: React.FC<BankStatementManagerProps> = ({
  onPushLog,
  externalFile,
  onRedirectToInvoice,
  onRegisterFile,
  onUpdateFile
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [data, setData] = useState<BankStatementData>({
    documentType: 'BANK_STATEMENT',
    bankName: "HDFC Bank",
    accountNumber: "0000",
    transactions: []
  });
  const [step, setStep] = useState<1 | 2>(1);
  const [isPushing, setIsPushing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showInvoiceAlert, setShowInvoiceAlert] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);

  const [companies, setCompanies] = useState<string[]>(getCompaniesFromCache() as string[]);
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [loadingCompanies, setLoadingCompanies] = useState(false);

  const [ledgers, setLedgers] = useState<string[]>([]);
  const [loadingLedgers, setLoadingLedgers] = useState(false);
  const [isUsingCache, setIsUsingCache] = useState(false);


  useEffect(() => {
    const checkDraft = () => {
      const saved = localStorage.getItem('autotally_bank_draft');
      setHasDraft(!!saved);
    };
    checkDraft();
  }, []);

  useEffect(() => {
    if (externalFile) {
      processFile(externalFile);
    }
  }, [externalFile]);

  useEffect(() => {
    if (step === 2) {
      const cached = getCompaniesFromCache() as string[];
      if (cached.length > 0) setCompanies(cached);
      else loadCompanies();
    }
  }, [step]);

  useEffect(() => {
    if (step === 2) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      const cachedSet = getLedgersFromCache(selectedCompany);
      if (cachedSet.size > 0) {
        setLedgers(Array.from(cachedSet).sort());
        setIsUsingCache(true);
      } else {
        fetchLedgers();
      }
    }
  }, [selectedCompany, step]);

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

  const fetchLedgers = async () => {
    setLoadingLedgers(true);
    setIsUsingCache(false);
    try {
      const ledgerSet = await fetchExistingLedgers(selectedCompany);
      setLedgers(Array.from(ledgerSet).sort());
    } catch (e) {
      console.error("Failed to load ledgers", e);
    } finally {
      setLoadingLedgers(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const processFile = async (uploadedFile: File) => {
    setFile(uploadedFile);
    let currentFileId = null;
    if (onRegisterFile) {
      currentFileId = onRegisterFile(uploadedFile);
      setFileId(currentFileId);
    }
    setIsProcessing(true);
    setShowInvoiceAlert(false);
    const start = Date.now();
    try {
      const result = await parseBankStatementWithGemini(uploadedFile);
      if (result.documentType === 'INVOICE') {
        setShowInvoiceAlert(true);
        setIsProcessing(false);
        if (onUpdateFile && currentFileId) onUpdateFile(currentFileId, { status: 'Mismatch', error: 'Detected as Invoice' });
        return;
      }
      const newData = { ...data, bankName: result.bankName || data.bankName, transactions: result.transactions };
      setData(newData);
      setStep(2);
      if (onUpdateFile && currentFileId) {
        const duration = ((Date.now() - start) / 1000 / 60).toFixed(2);
        onUpdateFile(currentFileId, { status: 'Ready', bankData: newData, correctEntries: result.transactions.length, timeTaken: `${duration} min` });
      }
    } catch (error) {
      onPushLog('Failed', 'Bank Statement Parsing Failed', error instanceof Error ? error.message : 'Unknown Error');
      if (onUpdateFile && currentFileId) onUpdateFile(currentFileId, { status: 'Failed', error: 'Parsing Failed' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRedirect = () => {
    if (onRedirectToInvoice && file) {
      onRedirectToInvoice(file);
      setFile(null); setStep(1); setShowInvoiceAlert(false);
    }
  };

  const handleSaveDraft = () => {
    localStorage.setItem('autotally_bank_draft', JSON.stringify(data));
    onPushLog('Success', 'Draft Saved', 'Bank statement draft saved locally.');
    setHasDraft(true);
  };

  const handleRestoreDraft = () => {
    try {
      const saved = localStorage.getItem('autotally_bank_draft');
      if (saved) { setData(JSON.parse(saved)); setStep(2); onPushLog('Success', 'Draft Restored', 'Loaded draft from storage.'); }
    } catch (e) { console.error(e); }
  };

  const clearDraft = () => { localStorage.removeItem('autotally_bank_draft'); setHasDraft(false); };

  const handleTransactionChange = (id: string, field: keyof BankTransaction, value: string | number) => {
    setData(prev => ({
      ...prev,
      transactions: prev.transactions.map(t => {
        if (t.id !== id) return t;
        return { ...t, [field]: value };
      })
    }));
  };

  const removeTransaction = (id: string) => { setData(prev => ({ ...prev, transactions: prev.transactions.filter(t => t.id !== id) })); };
  const addTransaction = () => { setData(prev => ({ ...prev, transactions: [...prev.transactions, { id: uuidv4(), date: new Date().toISOString().slice(0, 10), description: 'New Transaction', withdrawal: 0, deposit: 0, voucherType: 'Payment', contraLedger: 'Suspense A/c' }] })); };

  const handlePushToTally = async () => {
    setIsPushing(true);
    try {
      const existingLedgers = await fetchExistingLedgers(selectedCompany);
      const xml = generateBankStatementXml(data, existingLedgers, selectedCompany);
      const result = await pushToTally(xml);
      if (result.success) {
        onPushLog('Success', `Bank Statement (${data.bankName}) Pushed`, `${data.transactions.length} vouchers generated.`);
        if (onUpdateFile && fileId) onUpdateFile(fileId, { status: 'Success' });
      } else {
        onPushLog('Failed', 'Bank Statement Push Failed', result.message);
        if (onUpdateFile && fileId) onUpdateFile(fileId, { status: 'Failed', error: result.message });
      }
    } catch (e) {
      onPushLog('Failed', 'Network Error', e instanceof Error ? e.message : 'Unknown');
      if (onUpdateFile && fileId) onUpdateFile(fileId, { status: 'Failed', error: 'Network Error' });
    } finally { setIsPushing(false); }
  };

  const inputClass = "w-full px-2 py-1.5 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-tally-500 outline-none transition-colors";

  return (
    <div className="flex flex-col h-full gap-6 animate-fade-in relative transition-colors">
      <datalist id="bank-ledgers">{ledgers.map((l, i) => <option key={i} value={l} />)}</datalist>

      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex justify-between items-center shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 rounded-xl flex items-center justify-center shadow-inner">
            <Landmark className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white uppercase tracking-tight">Bank Statement Engine</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">Reconcile PDF bank transactions into Tally vouchers</p>
          </div>
        </div>

        {step === 2 && (
          <div className="flex items-center gap-3">
            <button onClick={handleSaveDraft} className="flex items-center gap-2 px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl text-sm font-bold transition-colors">
              <Save className="w-4 h-4" /> Save
            </button>
            <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-1"></div>
            <button onClick={handlePushToTally} disabled={isPushing} className="bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-2.5 rounded-xl font-black shadow-lg shadow-emerald-600/20 disabled:opacity-70 flex items-center gap-2 active:scale-95 transition-all">
              {isPushing ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
              Push to Tally
            </button>
          </div>
        )}
      </div>

      {step === 1 ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-white dark:bg-slate-800 rounded-[32px] border-4 border-dashed border-slate-200 dark:border-slate-700 p-16 shadow-sm group">
          <div className="w-24 h-24 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 rounded-full flex items-center justify-center mb-8 shadow-inner transition-transform group-hover:scale-110 duration-500">
            {isProcessing ? <Loader2 className="w-12 h-12 animate-spin" /> : <UploadCloud className="w-12 h-12" />}
          </div>
          {isProcessing ? (
            <div className="text-center">
              <h3 className="text-3xl font-black text-slate-900 dark:text-white">Processing Statement...</h3>
              <p className="text-slate-500 dark:text-slate-400 mt-2 font-medium">Identifying table structure and extracting rows</p>
            </div>
          ) : (
            <div className="text-center space-y-6 max-w-lg">
              <h3 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Upload Bank Statement</h3>
              <p className="text-slate-500 dark:text-slate-400 font-medium leading-relaxed">PDF statements from HDFC, ICICI, SBI, Kotak and more. AI will automatically classify Payment vs Receipt.</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="bg-orange-600 hover:bg-orange-700 text-white px-10 py-4 rounded-2xl font-bold text-lg shadow-xl shadow-orange-600/20 transition-all hover:-translate-y-1 active:scale-95 flex items-center gap-3 mx-auto"
              >
                Select Statement
                <ArrowRight className="w-5 h-5" />
              </button>
              <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" onChange={handleFileUpload} />

              {hasDraft && (
                <button onClick={handleRestoreDraft} className="flex items-center gap-2 px-5 py-2 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/30 rounded-xl text-sm font-bold transition-colors mx-auto mt-4">
                  <History className="w-4 h-4" /> Restore saved session
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 bg-white dark:bg-slate-800 rounded-[32px] border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden shadow-sm transition-colors">
          <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex flex-col md:flex-row md:items-center justify-between gap-6 bg-slate-50/50 dark:bg-slate-950/20 shrink-0">
            <div className="flex-1">
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Tally Bank Ledger</label>
              <div className="flex items-center gap-3">
                <input type="text" value={data.bankName} onChange={(e) => setData({ ...data, bankName: e.target.value })} className="flex-1 max-w-xs px-4 py-2.5 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm font-bold shadow-inner focus:ring-2 focus:ring-indigo-500 outline-none transition-all" placeholder="e.g. HDFC Bank - 8694" />
                <div className="h-8 w-px bg-slate-200 dark:bg-slate-700 mx-2"></div>
                <div className="flex-1 max-w-xs">
                  <div className="flex gap-2">
                    <select value={selectedCompany} onChange={(e) => setSelectedCompany(e.target.value)} className="flex-1 px-4 py-2 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-xs font-bold shadow-inner outline-none focus:ring-2 focus:ring-indigo-500 transition-all">
                      <option value="">Active Company</option>
                      {companies.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button onClick={fetchLedgers} className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-400 hover:text-blue-500 transition-colors shadow-sm" title="Refresh masters">{isUsingCache ? <Database className="w-4 h-4" /> : <RefreshCw className={`w-4 h-4 ${loadingLedgers ? 'animate-spin' : ''}`} />}</button>
                  </div>
                </div>
              </div>
            </div>
            <div className="text-right">
              <p className="text-lg font-black text-slate-900 dark:text-white tracking-tight uppercase">{data.transactions.length} Transactions</p>
              <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded uppercase tracking-widest">Verify & Map</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto overflow-x-auto scroll-smooth scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-600">
            <table className="w-full text-sm text-left border-collapse min-w-[1200px]">
              <thead className="bg-slate-50 dark:bg-slate-950/50 text-slate-400 dark:text-slate-500 font-black uppercase tracking-widest border-b border-slate-100 dark:border-slate-800 sticky top-0 z-10 text-[10px]">
                <tr>
                  <th className="px-6 py-4 w-32">Date</th>
                  <th className="px-6 py-4 min-w-[200px]">Description / Narration</th>
                  <th className="px-6 py-4 w-28">Vch Type</th>
                  <th className="px-6 py-4 w-28 text-right">Debit (Out)</th>
                  <th className="px-6 py-4 w-28 text-right">Credit (In)</th>
                  <th className="px-6 py-4 w-48">Counter Ledger</th>
                  <th className="px-6 py-4 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
                {data.transactions.map((txn) => (
                  <tr key={txn.id} className="group hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
                    <td className="px-4 py-2"><input type="text" value={txn.date} onChange={(e) => handleTransactionChange(txn.id, 'date', e.target.value)} className={inputClass} /></td>
                    <td className="px-4 py-2"><input type="text" value={txn.description} onChange={(e) => handleTransactionChange(txn.id, 'description', e.target.value)} className={inputClass} /></td>
                    <td className="px-4 py-2">
                      <select value={txn.voucherType} onChange={(e) => handleTransactionChange(txn.id, 'voucherType', e.target.value)} className={inputClass}>
                        <option value="Payment">Payment</option>
                        <option value="Receipt">Receipt</option>
                        <option value="Contra">Contra</option>
                      </select>
                    </td>
                    <td className="px-4 py-2"><input type="number" value={txn.withdrawal} onChange={(e) => handleTransactionChange(txn.id, 'withdrawal', parseFloat(e.target.value) || 0)} className={`${inputClass} text-right ${txn.withdrawal > 0 ? 'font-bold text-red-600 dark:text-red-400' : 'text-slate-300 dark:text-slate-600'}`} /></td>
                    <td className="px-4 py-2"><input type="number" value={txn.deposit} onChange={(e) => handleTransactionChange(txn.id, 'deposit', parseFloat(e.target.value) || 0)} className={`${inputClass} text-right ${txn.deposit > 0 ? 'font-bold text-emerald-600 dark:text-emerald-400' : 'text-slate-300 dark:text-slate-600'}`} /></td>
                    <td className="px-4 py-2"><input type="text" list="bank-ledgers" value={txn.contraLedger} onChange={(e) => handleTransactionChange(txn.id, 'contraLedger', e.target.value)} className={`${inputClass} ${(txn.contraLedger === 'Suspense A/c' || txn.contraLedger === 'UPI Suspense') ? 'border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-900/10' : ''}`} /></td>
                    <td className="px-4 py-2 text-center"><button onClick={() => removeTransaction(txn.id)} className="text-slate-300 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex justify-between items-center shrink-0">
            <button onClick={addTransaction} className="text-xs font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 transition-colors flex items-center gap-2">
              + Add Transaction Row
            </button>
            <div className="flex gap-8 text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
              <div className="flex items-center gap-2">Total Debit: <span className="text-sm text-red-600 dark:text-red-400 font-mono">₹{data.transactions.reduce((sum, t) => sum + (t.withdrawal || 0), 0).toFixed(2)}</span></div>
              <div className="flex items-center gap-2">Total Credit: <span className="text-sm text-emerald-600 dark:text-emerald-400 font-mono">₹{data.transactions.reduce((sum, t) => sum + (t.deposit || 0), 0).toFixed(2)}</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BankStatementManager;
