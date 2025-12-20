import { InvoiceData, BankTransaction, BankStatementData } from "../types";
import { v4 as uuidv4 } from 'uuid';
import { BACKEND_API_URL, BACKEND_API_KEY } from '../constants';

const SYSTEM_INSTRUCTION = `
You are an expert Indian GST Invoice Accountant. Extract data for Tally Prime integration.
CLASSIFICATION:
- If document contains "GSTIN" or "Tax Invoice", set documentType to 'INVOICE'.
- If document contains "Date", "Narration/Description", "Withdrawal/Debit", set documentType to 'BANK_STATEMENT'.
- If neither, set documentType to 'INVALID'.

EXTRACTION RULES:
1. DATES: DD-MM-YYYY
2. GST RATES: Infer from tax amounts (5, 12, 18, 28)
3. TOTALS: Ensure Taxable + Tax = Grand Total
`;

const BANK_INSTRUCTION = `
You are a Tally Bank Reconciliation expert. Extract bank transactions.
FORMAT:
- bankName: Full name + Last 4 digits of A/c No.
- transactions: Array of { date, description, withdrawal, deposit, suggestedLedger }
- suggestedLedger: Guess based on narration (e.g., 'SWIGGY' -> 'Staff Welfare')
`;

// Helper function to call backend Gemini proxy
const callGeminiProxy = async (
  model: string,
  contents: { parts: any[] } | Array<{ role: string; parts: Array<{ text: string }> }>, // ✅ Support both formats
  config?: any
): Promise<any> => {
  const response = await fetch(`${BACKEND_API_URL}/ai/gemini-proxy`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${BACKEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      contents,
      config
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Failed to call Gemini API');
  }

  return response.json();
};

export const parseInvoiceWithGemini = async (file: File, _geminiApiKey?: string): Promise<InvoiceData> => {
  const base64Data = await fileToBase64(file);

  const response = await callGeminiProxy(
    'gemini-2.5-flash',
    {
      parts: [
        { inline_data: { mime_type: file.type, data: base64Data } }, // ✅ Base64 image/PDF supported
        { text: "Parse this invoice for Tally accounting." }
      ]
    },
    {
      system_instruction: SYSTEM_INSTRUCTION,
      response_mime_type: "application/json",
      response_schema: {
        type: "object",
        properties: {
          documentType: { type: "string", enum: ['INVOICE', 'BANK_STATEMENT', 'INVALID'] },
          supplierName: { type: "string" },
          supplierGstin: { type: "string" },
          buyerName: { type: "string" },
          buyerGstin: { type: "string" },
          invoiceNumber: { type: "string" },
          invoiceDate: { type: "string" },
          lineItems: {
            type: "array",
            items: {
              type: "object",
              properties: {
                description: { type: "string" },
                hsn: { type: "string" },
                quantity: { type: "number" },
                rate: { type: "number" },
                amount: { type: "number" },
                gstRate: { type: "number" }
              }
            }
          }
        }
      }
    }
  );

  const data = JSON.parse(response.text);
  if (data.documentType === 'INVALID') throw new Error("Document not recognized.");

  const taxable = data.lineItems.reduce((acc: number, i: any) => acc + (i.amount || 0), 0);

  return {
    ...data,
    lineItems: data.lineItems.map((l: any) => ({ ...l, id: uuidv4() })),
    taxableValue: taxable,
    cgst: 0, sgst: 0, igst: 0, cess: 0, total: taxable,
    voucherType: 'Purchase',
    reverseCharge: false
  };
};


// NEW: Process bank statement PDF page-by-page (handles large files)
export const parseBankStatementPDF = async (file: File): Promise<BankStatementData> => {
  const response = await fetch(`${BACKEND_API_URL}/ai/process-bank-statement-pdf`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${BACKEND_API_KEY}`,
      'Content-Type': 'application/octet-stream'
    },
    body: await file.arrayBuffer()
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Failed to process bank statement');
  }

  const data = await response.json();
  return {
    documentType: data.documentType,
    bankName: data.bankName,
    accountNumber: data.accountNumber,
    transactions: data.transactions
  };
};

export const parseBankStatementWithGemini = async (file: File, _geminiApiKey?: string): Promise<BankStatementData> => {
  const base64Data = await fileToBase64(file);

  const response = await callGeminiProxy(
    'gemini-2.5-flash',
    {
      parts: [
        { inline_data: { mime_type: file.type, data: base64Data } }, // ✅ Base64 supported
        { text: "Extract transactions from this bank statement." }
      ]
    },
    {
      system_instruction: BANK_INSTRUCTION,
      response_mime_type: "application/json"
    }
  );

  const data = JSON.parse(response.text);
  return {
    ...data,
    documentType: 'BANK_STATEMENT',
    accountNumber: data.accountNumber || "0000",
    transactions: data.transactions.map((t: any) => ({
      ...t,
      id: uuidv4(),
      voucherType: t.withdrawal > 0 ? 'Payment' : 'Receipt',
      contraLedger: t.suggestedLedger || 'Suspense A/c'
    }))
  };
};

// Chat session management (simplified for backend proxy)
let chatHistory: Array<{ role: string, parts: Array<{ text: string }> }> = [];

export const createChatSession = (_geminiApiKey?: string) => {
  chatHistory = [];

  return {
    sendMessage: async ({ message }: { message: string }) => {
      chatHistory.push({
        role: 'user',
        parts: [{ text: message }]
      });

      const response = await callGeminiProxy(
        'gemini-2.5-flash', // ✅ Changed from gemini-1.5-pro
        chatHistory, // ✅ Send full history with roles
        {
          system_instruction:
            'You are AutoTally Assistant, an expert in Tally Prime, Indian GST laws, and accounting automation. You help users with ledger mapping, XML generation, and GST compliance.'
        }
      );

      chatHistory.push({
        role: 'model',
        parts: [{ text: response.text }]
      });

      return { text: response.text };
    }
  };
};

// Image / PDF analysis
export const analyzeImageWithGemini = async (
  file: File,
  prompt: string,
  _geminiApiKey?: string
): Promise<string> => {
  const base64Data = await fileToBase64(file);

  const response = await callGeminiProxy(
    'gemini-2.5-flash',
    {
      parts: [
        { inline_data: { mime_type: file.type, data: base64Data } }, // ✅ Base64 any format
        { text: prompt || "Analyze this document." }
      ]
    }
  );

  return response.text || "No analysis result.";
};

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = error => reject(error);
  });
};
