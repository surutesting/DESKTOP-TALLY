
import React, { useCallback, useState, useRef } from 'react';
import { UploadCloud, Zap, History, FileUp, FileText, CheckCircle, ShieldCheck, ArrowRight, Loader2, Landmark, Sparkles } from 'lucide-react';
import { InvoiceData } from '../types';

interface InvoiceUploadProps {
  onFilesSelected: (files: File[]) => void;
  onRestoreDraft?: (data: InvoiceData) => void;
  isProcessing?: boolean;
}

const InvoiceUpload: React.FC<InvoiceUploadProps> = ({ onFilesSelected, onRestoreDraft, isProcessing = false }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFilesSelected(Array.from(e.dataTransfer.files));
    }
  }, [onFilesSelected]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesSelected(Array.from(e.target.files));
    }
  };

  const handleRestoreDraft = () => {
    try {
      const saved = localStorage.getItem('autotally_autosave');
      if (saved && onRestoreDraft) {
        const data = JSON.parse(saved);
        onRestoreDraft(data);
      }
    } catch (e) {
      console.error("Failed to restore draft", e);
    }
  };

  const hasSavedDraft = typeof window !== 'undefined' && !!localStorage.getItem('autotally_autosave');

  if (isProcessing) {
    return (
      <div className="flex flex-col h-full gap-6 animate-fade-in relative">
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex justify-between items-center transition-colors">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center shadow-inner">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">AI Processing Pipeline</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">Extracting data using Gemini 2.5 Multi-modal AI</p>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center bg-white dark:bg-slate-800 rounded-[32px] border border-slate-200 dark:border-slate-700 p-12 relative overflow-hidden shadow-sm">
          <div className="relative mb-12">
            <div className="w-32 h-32 bg-indigo-50 dark:bg-indigo-900/20 rounded-full flex items-center justify-center">
              <Sparkles className="w-16 h-16 text-indigo-500 animate-pulse" />
            </div>
            <div className="absolute inset-0 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin"></div>
          </div>

          <div className="text-center space-y-4 max-w-md">
            <h3 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Analyzing Documents</h3>
            <p className="text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
              Please wait while our AI identifies ledgers, GSTINs, and line items. You'll be redirected to the editor automatically.
            </p>

            <div className="w-full bg-slate-100 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden mt-8">
              <div className="bg-indigo-600 h-full w-1/3 animate-progress-indeterminate"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-6 animate-fade-in relative">
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex justify-between items-center transition-colors">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center shadow-inner">
            <FileUp className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Invoice AI Processing</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">Auto-extract GST details, items & dates from document</p>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-50 dark:bg-slate-900 rounded-full border border-slate-200 dark:border-slate-700">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
          <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest leading-none">Gemini 2.5 Active</span>
        </div>
      </div>

      <div
        className={`
          flex-1 flex flex-col items-center justify-center bg-white dark:bg-slate-800 rounded-[32px] border-4 border-dashed transition-all duration-300 p-12 relative overflow-hidden shadow-sm
          ${isDragOver
            ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-900/10 scale-[0.99]'
            : 'border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-500 hover:bg-slate-50/50 dark:hover:bg-slate-900/20'}
          `}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        <div className="w-24 h-24 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-full flex items-center justify-center mb-8 shadow-inner transition-transform duration-500 group-hover:scale-110">
          <UploadCloud className="w-12 h-12" />
        </div>

        <div className="text-center space-y-4 max-w-md">
          <h3 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Drop Invoices Here</h3>
          <p className="text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
            Support Bulk upload of PDF, JPG, and PNG formats.</p>

          <div className="pt-4 flex flex-col items-center gap-4">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-10 py-4 rounded-2xl font-bold text-lg shadow-xl shadow-indigo-600/20 transition-all hover:-translate-y-1 active:scale-95 flex items-center gap-3"
            >
              Select Documents
              <ArrowRight className="w-5 h-5" />
            </button>
            <input ref={fileInputRef} type="file" multiple className="hidden" accept=".pdf,.jpg,.png" onChange={handleFileInput} />

            {hasSavedDraft && (
              <button
                onClick={handleRestoreDraft}
                className="flex items-center gap-2 px-5 py-2 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-xl text-sm font-bold transition-colors"
              >
                <History className="w-4 h-4" />
                Restore unsaved draft
              </button>
            )}
          </div>
        </div>

        <div className="absolute top-12 left-12 opacity-[0.03] dark:opacity-[0.05] pointer-events-none rotate-[-12deg]">
          <FileText className="w-32 h-32 text-indigo-600" />
        </div>
        <div className="absolute bottom-12 right-12 opacity-[0.03] dark:opacity-[0.05] pointer-events-none rotate-[15deg]">
          <CheckCircle className="w-32 h-32 text-emerald-600" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 shrink-0">
        {[
          { icon: Zap, label: 'Instant OCR', desc: 'Auto-identify party, GSTIN and line items.', color: 'text-indigo-500' },
          { icon: Landmark, label: 'Tally Ready', desc: 'Direct XML generation for Tally Prime.', color: 'text-emerald-500' },
          { icon: ShieldCheck, label: 'Client Privacy', desc: 'Documents processed locally in-browser.', color: 'text-amber-500' }
        ].map((feat, i) => (
          <div key={i} className="flex items-start gap-4 p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm transition-colors">
            <div className={`w-10 h-10 bg-slate-50 dark:bg-slate-900 rounded-xl flex items-center justify-center shadow-inner border border-slate-100 dark:border-slate-700 ${feat.color}`}>
              <feat.icon className="w-5 h-5 fill-current opacity-20" />
              <feat.icon className="w-5 h-5 absolute" />
            </div>
            <div>
              <h4 className="text-xs font-black uppercase text-slate-800 dark:text-white tracking-wider">{feat.label}</h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-1 leading-relaxed">{feat.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default InvoiceUpload;
