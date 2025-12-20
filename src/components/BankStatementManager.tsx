// frontend/src/components/BankStatementManager.tsx
import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, FileText, ArrowRight, Loader2, Trash2, Landmark, Save, History } from 'lucide-react';
import { BankStatementData, BankTransaction, ProcessedFile } from '../types';
import { parseBankStatementWithGemini, parseBankStatementPDF } from '../services/geminiService';
import { generateBankStatementXml, pushToTally, fetchExistingLedgers, fetchOpenCompanies } from '../services/tallyService';
import { v4 as uuidv4 } from 'uuid';

interface BankStatementManagerProps {
  onPushLog: (status: 'Success' | 'Failed', message: string, response?: string) => void;
  externalFile?: File | null;
  externalData?: BankStatementData | null; // Pre-loaded data from dashboard
  onMismatchDetected?: (file: File, detectedType: 'INVOICE') => void;
  onRegisterFile?: (file: File) => string;
  onUpdateFile?: (id: string, updates: Partial<ProcessedFile>) => void;
}

const BankStatementManager: React.FC<BankStatementManagerProps> = ({
  onPushLog, externalFile, externalData, onMismatchDetected, onRegisterFile, onUpdateFile
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [data, setData] = useState<BankStatementData>({ bankName: "HDFC Bank", accountNumber: undefined, transactions: [] });
  const [step, setStep] = useState<1 | 2>(1);
  const [isPushing, setIsPushing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showInvoiceAlert, setShowInvoiceAlert] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const pageScrollRef = useRef<HTMLDivElement>(null);
  const processedFileRef = useRef<string | null>(null);

  // Company and Ledger state
  const [companies, setCompanies] = useState<string[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [availableLedgers, setAvailableLedgers] = useState<string[]>([]);
  const [ledgerSuggestions, setLedgerSuggestions] = useState<string[]>([]);
  const [activeSuggestionField, setActiveSuggestionField] = useState<string | null>(null);

  useEffect(() => {
    if (pageScrollRef.current && data.transactions.length > 0) {
      pageScrollRef.current.scrollTop = pageScrollRef.current.scrollHeight;
    }
  }, [data.transactions]);

  useEffect(() => {
    const saved = localStorage.getItem('autotally_bank_draft');
    setHasDraft(!!saved);
  }, []);

  // Fetch companies and ledgers on mount
  useEffect(() => {
    const loadCompaniesAndLedgers = async () => {
      try {
        const companyList = await fetchOpenCompanies();
        setCompanies(companyList);
        if (companyList.length > 0) {
          setSelectedCompany(companyList[0]);
          const ledgers = await fetchExistingLedgers(companyList[0]);
          setAvailableLedgers(Array.from(ledgers));
        }
      } catch (error) {
        console.error('Failed to load companies/ledgers:', error);
      }
    };
    loadCompaniesAndLedgers();
  }, []);

  // Reload ledgers when company changes
  useEffect(() => {
    if (selectedCompany) {
      fetchExistingLedgers(selectedCompany).then(ledgers => {
        setAvailableLedgers(Array.from(ledgers));
      });
    }
  }, [selectedCompany]);

  useEffect(() => {
    // Only process if we have a new file that hasn't been processed yet
    if (externalFile && externalFile.name !== processedFileRef.current && !isProcessing) {
      processFile(externalFile);
    }
  }, [externalFile]); // Only watch externalFile, NOT isProcessing

  // Load external data if provided (from dashboard re-open)
  useEffect(() => {
    if (externalData && externalData.transactions.length > 0) {
      setData(externalData);
      setStep(2); // Skip to transaction table
    }
  }, [externalData]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) processFile(e.target.files[0]);
  };

  const processFile = async (uploadedFile: File, retryAttempt = 0) => {
    // Prevent concurrent processing
    if (isProcessing && retryAttempt === 0) {
      console.log('⚠️ Already processing, skipping...');
      return;
    }

    setFile(uploadedFile);
    let currentFileId: string | null = null;

    // Only register on first attempt
    if (retryAttempt === 0 && onRegisterFile) {
      currentFileId = onRegisterFile(uploadedFile);
      setFileId(currentFileId);
    }

    // On retries, fallback to the state fileId if local currentFileId is null
    // Note: In retries, fileId state should be populated from the first attempt
    const activeFileId = currentFileId || fileId;

    setIsProcessing(true);
    setShowInvoiceAlert(false);
    const start = Date.now();

    try {
      // Use page-by-page processing for PDFs to handle large files
      const result = uploadedFile.type === 'application/pdf'
        ? await parseBankStatementPDF(uploadedFile)
        : await parseBankStatementWithGemini(uploadedFile);

      if (result.documentType === 'INVOICE') {
        setShowInvoiceAlert(true);
        // Mark as processed so we don't loop, even though it's the "wrong" type
        processedFileRef.current = uploadedFile.name;
        if (onUpdateFile && activeFileId) {
          onUpdateFile(activeFileId, { status: 'Failed', error: 'Detected as Invoice, not Bank Statement' });
        }
        return;
      }

      setStep(2);
      const newData = {
        ...result,
        transactions: result.transactions.map(t => ({
          ...t,
          id: uuidv4(),
          contraLedger: t.contraLedger || guessLedgerFromDescription(t.description),
          voucherType: (t.withdrawal > 0 ? 'Payment' : 'Receipt') as 'Payment' | 'Receipt' | 'Contra'
        }))
      };
      setData(newData);

      // Success! Mark as processed.
      processedFileRef.current = uploadedFile.name;

      const duration = ((Date.now() - start) / 1000 / 60).toFixed(1);
      const correctCount = newData.transactions.filter(t => t.contraLedger !== 'Suspense A/c').length;
      const expectedFields = newData.transactions.length; // Approximate

      onPushLog('Success', 'Bank Statement Analyzed', `Found ${newData.transactions.length} transactions.`);

      if (onUpdateFile && activeFileId) {
        onUpdateFile(activeFileId, {
          status: 'Success',
          bankData: newData,
          correctEntries: correctCount,
          incorrectEntries: Math.max(0, expectedFields - correctCount),
          timeTaken: `${duration} min`
        });
      }
    } catch (error: any) {
      const detail =
        error?.message ||
        error?.response?.detail ||
        (typeof error === "string" ? error : JSON.stringify(error));

      // No retries - fail immediately after first attempt
      if (retryAttempt < 0) {
        console.warn(`❌ Attempt ${retryAttempt + 1} failed. Retrying in 2s...`);
        onPushLog('Failed', `Attempt ${retryAttempt + 1} Failed`, `Retrying in 2 seconds...`);

        setTimeout(() => {
          processFile(uploadedFile, retryAttempt + 1);
        }, 2000);
        return; // Exit here, don't set isProcessing false yet
      }

      // Final failure
      console.error(`❌ Processing failed: ${detail}`);
      onPushLog('Failed', 'Bank Statement Processing Failed', detail);
      processedFileRef.current = uploadedFile.name; // Stop any further processing

      if (onUpdateFile && activeFileId) {
        onUpdateFile(activeFileId, {
          status: 'Failed',
          error: detail
        });
      }
    } finally {
      // Clear processing state unless we're retrying (which returns early above)
      // If we reach here, it's either success or final failure
      setIsProcessing(false);
    }
  };

  const handleClearAlert = () => {
    setFile(null);
    setStep(1);
    setShowInvoiceAlert(false);
  };

  const handleRedirect = () => {
    if (file) {
      onMismatchDetected?.(file, 'INVOICE');
      setFile(null);
      setStep(1);
      setShowInvoiceAlert(false);
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
      if (saved) {
        const parsed = JSON.parse(saved);
        setData(parsed);
        setStep(2);
        onPushLog('Success', 'Draft Restored', 'Loaded draft from storage.');
      }
    } catch (e) { console.error(e); }
  };

  const clearDraft = () => {
    localStorage.removeItem('autotally_bank_draft');
    setHasDraft(false);
  };

  const guessLedgerFromDescription = (desc: string): string => {
    const lower = desc.toLowerCase();
    if (lower.includes('swiggy') || lower.includes('zomato') || lower.includes('mcdonalds') || lower.includes('pizza')) return 'Staff Welfare';
    if (lower.includes('uber') || lower.includes('ola') || lower.includes('fuel') || lower.includes('petrol')) return 'Travelling Expenses';
    if (lower.includes('amazon') || lower.includes('flipkart')) return 'Office Expenses';
    if (lower.includes('airtel') || lower.includes('jio') || lower.includes('vi') || lower.includes('bsnl') || lower.includes('internet')) return 'Telephone & Internet';
    if (lower.includes('electricity') || lower.includes('power') || lower.includes('mse')) return 'Electricity Charges';
    if (lower.includes('rent')) return 'Rent';
    if (lower.includes('interest')) return 'Bank Interest';
    if (lower.includes('charges') || lower.includes('fee')) return 'Bank Charges';
    if (lower.includes('upi') || lower.includes('paytm') || lower.includes('gpay') || lower.includes('phonepe')) return 'UPI Suspense';
    if (lower.includes('neft') || lower.includes('rtgs') || lower.includes('imps') || lower.includes('swift')) return 'Bank Transfers';
    if (lower.includes('salary')) return 'Salary Payable';
    return 'Suspense A/c';
  };

  const handleTransactionChange = (id: string, field: keyof BankTransaction, value: string | number) => {
    setData(prev => ({
      ...prev,
      transactions: prev.transactions.map(t => {
        if (t.id !== id) return t;
        const updated = { ...t, [field]: value } as BankTransaction;
        if (field === 'description' && typeof value === 'string') {
          const currentLedger = t.contraLedger;
          if (!currentLedger || currentLedger === 'Suspense A/c' || currentLedger === 'UPI Suspense') {
            const guessed = guessLedgerFromDescription(value);
            if (guessed !== 'Suspense A/c') updated.contraLedger = guessed;
          }
        }
        return updated;
      })
    }));
  };

  const removeTransaction = (id: string) => {
    setData(prev => ({ ...prev, transactions: prev.transactions.filter(t => t.id !== id) }));
  };

  const addTransaction = () => {
    setData(prev => ({
      ...prev,
      transactions: [
        ...prev.transactions,
        {
          id: uuidv4(),
          date: new Date().toISOString().slice(0, 10),
          description: 'New Transaction',
          withdrawal: 0,
          deposit: 0,
          voucherType: 'Payment',
          contraLedger: 'Suspense A/c'
        }
      ]
    }));
  };

  const handlePushToTally = async () => {
    setIsPushing(true);
    try {
      const existingLedgers = await fetchExistingLedgers();
      const xml = generateBankStatementXml(data, existingLedgers);
      const result = await pushToTally(xml);
      if (result.success) {
        const displayName = data.accountNumber ? `${data.bankName}-${data.accountNumber.replace(/\D/g, '').slice(-4)}` : data.bankName;
        onPushLog('Success', `Bank Statement (${displayName}) Pushed`, `${data.transactions.length} vouchers generated. Missing ledgers auto-created.`);
        if (onUpdateFile && fileId) onUpdateFile(fileId, { status: 'Success' });
      } else {
        onPushLog('Failed', 'Bank Statement Push Failed', result.message);
        if (onUpdateFile && fileId) onUpdateFile(fileId, { status: 'Failed', error: result.message });
      }
    } catch (e) {
      onPushLog('Failed', 'Network Error', e instanceof Error ? e.message : 'Unknown');
      if (onUpdateFile && fileId) onUpdateFile(fileId, { status: 'Failed', error: 'Network Error' });
    } finally {
      setIsPushing(false);
    }
  };

  const inputClass = "w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-tally-500 outline-none";

  return (
    <div ref={pageScrollRef} className="flex flex-col h-full gap-6 animate-fade-in relative">
      {showInvoiceAlert && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm rounded-xl animate-fade-in">
          <div className="bg-white dark:bg-slate-800 p-8 rounded-xl shadow-2xl border-2 border-orange-400 max-w-md w-full text-center">
            <div className="w-16 h-16 bg-orange-100 dark:bg-orange-900/30 text-orange-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white">This looks like an Invoice!</h3>
            <p className="text-slate-500 dark:text-slate-400 mt-2 mb-6">
              You uploaded <span className="font-semibold text-slate-800 dark:text-slate-200">{file?.name}</span> in the Bank Statement section, but it appears to be a Tax Invoice.
            </p>
            <div className="flex flex-col gap-3">
              <button onClick={handleRedirect} className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow-lg transition-transform hover:-translate-y-1 flex items-center justify-center gap-2">
                <ArrowRight className="w-4 h-4" /> Process as Invoice
              </button>
              <button onClick={() => setShowInvoiceAlert(false)} className="w-full py-3 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 font-semibold">
                No, keep here (Force parse)
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Landmark className="w-6 h-6 text-tally-600" /> Bank Statement Processing
          </h2>
          <p className="text-sm text-slate-500">Extract PDF statements to Payment/Receipt vouchers</p>
        </div>

        {step === 2 && (
          <div className="flex items-center gap-3">
            <button onClick={handleSaveDraft} className="flex items-center gap-2 px-3 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-sm font-medium transition-colors" title="Save progress locally">
              <Save className="w-4 h-4" /> Save Draft
            </button>
            <div className="h-4 w-px bg-slate-300 dark:bg-slate-600 mx-1"></div>
            <button onClick={() => setStep(1)} className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white text-sm font-medium">
              Upload New
            </button>
            <button onClick={handlePushToTally} disabled={isPushing} className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg font-medium flex items-center gap-2 shadow-lg disabled:opacity-70 disabled:cursor-not-allowed">
              {isPushing ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
              {isPushing ? 'Updating Tally...' : 'Push to Tally'}
            </button>
          </div>
        )}
      </div>

      {step === 1 ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-white dark:bg-slate-800 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-12">
          <div className="w-20 h-20 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-full flex items-center justify-center mb-6">
            {isProcessing ? <Loader2 className="w-10 h-10 animate-spin" /> : <UploadCloud className="w-10 h-10" />}
          </div>

          {isProcessing ? (
            <div className="text-center">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Analyzing Statement...</h3>
              <p className="text-slate-500 mt-2">Extracting dates, descriptions, and amounts.</p>
            </div>
          ) : (
            <div className="text-center space-y-4">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">Upload Bank Statement</h3>
              <p className="text-slate-500 max-w-md mx-auto">Upload a PDF or Image of your bank statement. AI will convert rows into Payment/Receipt vouchers.</p>
              <button onClick={() => fileInputRef.current?.click()} className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-lg font-bold shadow-md hover:shadow-lg transition-all">Select PDF / Image</button>
              <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" onChange={handleFileUpload} />
            </div>
          )}

          {hasDraft && !isProcessing && (
            <div className="mt-6 flex items-center gap-3 animate-fade-in">
              <button onClick={handleRestoreDraft} className="flex items-center gap-2 px-4 py-2 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 rounded-lg text-sm font-semibold hover:bg-indigo-100 transition-colors">
                <History className="w-4 h-4" /> Restore Saved Draft
              </button>
              <button onClick={clearDraft} className="p-2 text-slate-400 hover:text-red-500 transition-colors" title="Discard Draft"><Trash2 className="w-4 h-4" /></button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50 dark:bg-slate-900/50">
            <div className="flex-1">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Your Tally Bank Ledger Name</label>
              <input
                type="text"
                value={data.accountNumber ? `${data.bankName}-${data.accountNumber}` : data.bankName}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  // Parse the combined format "Bank Name-XXXX"
                  const dashIndex = val.lastIndexOf('-');
                  if (dashIndex > 0) {
                    const bankName = val.substring(0, dashIndex);
                    const acctNum = val.substring(dashIndex + 1).replace(/\D/g, '').slice(-4);
                    setData({ ...data, bankName, accountNumber: acctNum || undefined });
                  } else {
                    setData({ ...data, bankName: val, accountNumber: undefined });
                  }
                }}
                className="inline-block px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm font-semibold"
                placeholder="e.g. Kotak Mahindra Bank-8694"
              />
              <p className="text-[10px] text-slate-400 mt-1">If this ledger doesn't exist, it will be auto-created in 'Bank Accounts'.</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-slate-900 dark:text-white">{data.transactions.length} Transactions</p>
              <p className="text-xs text-slate-500">Review & Map Ledgers below</p>
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 dark:bg-slate-700/50 text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-700 sticky top-0">
                <tr>
                  <th className="px-4 py-3 w-32">Date</th>
                  <th className="px-4 py-3 min-w-[200px]">Description (Narration)</th>
                  <th className="px-4 py-3 w-28">Type</th>
                  <th className="px-4 py-3 w-28 text-right">Debit</th>
                  <th className="px-4 py-3 w-28 text-right">Credit</th>
                  <th className="px-4 py-3 w-48">Contra Ledger (Expense/Party)</th>
                  <th className="px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {data.transactions.map((txn) => (
                  <tr key={txn.id} className="group hover:bg-slate-50 dark:hover:bg-slate-700/30">
                    <td className="p-2">
                      <input type="text" value={txn.date} onChange={(e) => handleTransactionChange(txn.id, 'date', e.target.value)} className={inputClass} />
                    </td>
                    <td className="p-2">
                      <input type="text" value={txn.description} onChange={(e) => handleTransactionChange(txn.id, 'description', e.target.value)} className={inputClass} />
                    </td>
                    <td className="p-2">
                      <select value={txn.voucherType} onChange={(e) => handleTransactionChange(txn.id, 'voucherType', e.target.value)} className={inputClass}>
                        <option value="Payment">Payment</option>
                        <option value="Receipt">Receipt</option>
                        <option value="Contra">Contra</option>
                      </select>
                    </td>
                    <td className="p-2">
                      <input type="number" value={txn.withdrawal} onChange={(e) => handleTransactionChange(txn.id, 'withdrawal', parseFloat(e.target.value) || 0)} className={`${inputClass} text-right ${txn.withdrawal > 0 ? 'font-bold text-red-600 dark:text-red-400' : 'text-slate-400'}`} />
                    </td>
                    <td className="p-2">
                      <input type="number" value={txn.deposit} onChange={(e) => handleTransactionChange(txn.id, 'deposit', parseFloat(e.target.value) || 0)} className={`${inputClass} text-right ${txn.deposit > 0 ? 'font-bold text-green-600 dark:text-green-400' : 'text-slate-400'}`} />
                    </td>
                    <td className="p-2">
                      <input type="text" value={txn.contraLedger} onChange={(e) => handleTransactionChange(txn.id, 'contraLedger', e.target.value)} className={`${inputClass} ${(txn.contraLedger === 'Suspense A/c' || txn.contraLedger === 'UPI Suspense') ? 'border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20' : ''}`} placeholder="Tally Ledger Name" />
                    </td>
                    <td className="p-2 text-center">
                      <button onClick={() => removeTransaction(txn.id)} className="text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex justify-between items-center">
            <button onClick={addTransaction} className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline">+ Add Empty Row</button>
            <div className="flex gap-4 text-sm font-bold text-slate-700 dark:text-slate-300">
              <span>Total Withdrawals: <span className="text-red-600">₹{Number(data.transactions.reduce((sum, t) => sum + (Number(t.withdrawal) || 0), 0)).toFixed(2)}</span></span>
              <span>Total Deposits: <span className="text-green-600">₹{Number(data.transactions.reduce((sum, t) => sum + (Number(t.deposit) || 0), 0)).toFixed(2)}</span></span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BankStatementManager;
