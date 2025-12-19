import { InvoiceData } from './types';

/**
 * ARCHITECTURE:
 * 
 * Backend API (https://autotally-backend.onrender.com)
 *   - Holds API keys
 *   - AI document processing
 *   - Invoice storage/history
 *   - Does NOT connect to Tally
 * 
 * React App (Agent/Middleware)
 *   - Business logic
 *   - Connects to Backend API
 *   - Connects DIRECTLY to Local Tally Prime
 * 
 * Local Tally Prime (http://127.0.0.1:9000)
 *   - Only React connects directly
 *   - Backend has NO connection
 */

// Backend API Configuration - AI & Data Only (No Tally)
export const BACKEND_API_URL = import.meta.env.VITE_BACKEND_API_URL || 'https://desktopserver.onrender.com';
export const BACKEND_API_KEY = import.meta.env.VITE_BACKEND_API_KEY || '';

// Tally Prime runs on port 9000 - Connected DIRECTLY from React only
export const TALLY_API_URL = import.meta.env.VITE_TALLY_API_URL || 'http://127.0.0.1:9000';

// API Endpoints - Backend ONLY (No Tally endpoints)
export const API_ENDPOINTS = {
  // Authentication
  login: '/auth/login',
  validateKey: '/auth/validate',

  // AI Processing (Document Analysis)
  processDocument: '/ai/process-document',
  processBulk: '/ai/process-bulk',

  // Data Management (Server backup/history)
  saveInvoice: '/invoices/save',
  getInvoices: '/invoices/list',
  deleteInvoice: '/invoices/delete',

  // Logging & Analytics
  logEvent: '/logs/event',
  getHistory: '/history',
};

export const MOCK_INVOICE: InvoiceData = {
  supplierName: 'Tech Solutions Pvt Ltd',
  supplierGstin: '27ABCDE1234F1Z5',
  buyerName: 'Global Traders Inc',
  buyerGstin: '27XYZAB5678C1Z2',
  invoiceNumber: 'INV-2024-001',
  invoiceDate: '01-08-2025',
  voucherType: 'Purchase',
  lineItems: [
    {
      id: '1',
      description: 'Dell Latitude 7420 Laptop',
      hsn: '8471',
      quantity: 1,
      rate: 45000,
      amount: 45000,
      gstRate: 12,
      unit: 'Nos'
    },
    {
      id: '2',
      description: 'Logitech MX Master 3',
      hsn: '8471',
      quantity: 5,
      rate: 9000,
      amount: 45000,
      gstRate: 18,
      unit: 'Nos'
    }
  ]
};

export const EMPTY_INVOICE: InvoiceData = {
  supplierName: '',
  supplierGstin: '',
  buyerName: '',
  buyerGstin: '',
  invoiceNumber: '',
  invoiceDate: '',
  voucherType: 'Purchase',
  lineItems: []
};
