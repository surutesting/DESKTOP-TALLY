import { BACKEND_API_URL } from '../constants';
import { InvoiceData } from '../types';

/**
 * Backend Service - AI Integration & Data Storage ONLY
 * Architecture: Backend handles AI & storage. React connects both to Backend & Tally.
 */

interface BackendResponse<T = any> {
  success: boolean;
  data?: T;
  message: string;
  error?: string;
}

const apiRequest = async <T = any>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: any,
  apiKey?: string
): Promise<BackendResponse<T>> => {
  try {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const options: RequestInit = {
      method,
      headers,
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(endpoint, options);
    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        message: data.message || `HTTP ${response.status}`,
        error: data.error,
      };
    }

    return {
      success: true,
      data,
      message: data.message || 'Success',
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Network error: ${error.message}`,
      error: error.message,
    };
  }
};

// Authenticate
export const authenticateBackend = async (
  username: string,
  password: string
): Promise<{ success: boolean; token?: string; message: string }> => {
  const response = await apiRequest<{ token: string; user: any }>(
    `${BACKEND_API_URL}/auth/login`,
    'POST',
    { username, password }
  );

  return {
    success: response.success,
    token: response.data?.token,
    message: response.message,
  };
};

// Validate API Key
export const validateApiKey = async (apiKey: string): Promise<boolean> => {
  const response = await apiRequest(
    `${BACKEND_API_URL}/auth/validate`,
    'GET',
    undefined,
    apiKey
  );

  return response.success;
};

// Sync companies from backend (backend handles Tally sync server-side)
// Uses backend's API key for secure Tally access
export const syncCompaniesFromBackend = async (
  apiKey: string
): Promise<{
  success: boolean;
  companies?: string[];
  message: string;
}> => {
  const response = await apiRequest<{ companies: string[] }>(
    `${BACKEND_API_URL}/tally/companies`,
    'GET',
    undefined,
    apiKey
  );

  return {
    success: response.success,
    companies: response.data?.companies,
    message: response.message,
  };
};

// Sync ledgers for a specific company from backend
export const syncLedgersFromBackend = async (
  companyName: string,
  apiKey: string
): Promise<{
  success: boolean;
  ledgers?: string[];
  message: string;
}> => {
  const response = await apiRequest<{ ledgers: string[] }>(
    `${BACKEND_API_URL}/tally/ledgers/${encodeURIComponent(companyName)}`,
    'GET',
    undefined,
    apiKey
  );

  return {
    success: response.success,
    ledgers: response.data?.ledgers,
    message: response.message,
  };
};

// Process document with AI
export const processDocumentWithAI = async (
  file: File,
  apiKey: string
): Promise<{
  success: boolean;
  invoice?: InvoiceData;
  message: string;
}> => {
  try {
    const formData = new FormData();
    formData.append('file', file);

    const headers: HeadersInit = {
      'Authorization': `Bearer ${apiKey}`,
    };

    const response = await fetch(`${BACKEND_API_URL}/ai/process-document`, {
      method: 'POST',
      headers,
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        message: data.message || 'Failed to process document',
      };
    }

    return {
      success: true,
      invoice: data.invoice,
      message: data.message || 'Document processed successfully',
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Error processing document: ${error.message}`,
    };
  }
};

// Process bulk documents
export const processBulkDocumentsWithAI = async (
  files: File[],
  apiKey: string
): Promise<{
  success: boolean;
  invoices?: InvoiceData[];
  successful: number;
  failed: number;
  message: string;
}> => {
  try {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));

    const headers: HeadersInit = {
      'Authorization': `Bearer ${apiKey}`,
    };

    const response = await fetch(`${BACKEND_API_URL}/ai/process-bulk`, {
      method: 'POST',
      headers,
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        successful: 0,
        failed: files.length,
        message: data.message || 'Failed to process bulk documents',
      };
    }

    return {
      success: true,
      invoices: data.invoices,
      successful: data.successful || 0,
      failed: data.failed || 0,
      message: data.message || 'Bulk processing completed',
    };
  } catch (error: any) {
    return {
      success: false,
      successful: 0,
      failed: files.length,
      message: `Error processing bulk: ${error.message}`,
    };
  }
};

// Save invoice to backend
export const saveInvoiceToBackend = async (
  invoice: InvoiceData,
  apiKey: string
): Promise<{ success: boolean; id?: string; message: string }> => {
  const response = await apiRequest<{ id: string }>(
    `${BACKEND_API_URL}/invoices/save`,
    'POST',
    { invoice },
    apiKey
  );

  return {
    success: response.success,
    id: response.data?.id,
    message: response.message,
  };
};

// Get invoices from backend
export const getInvoicesFromBackend = async (
  apiKey: string,
  limit: number = 50
): Promise<InvoiceData[]> => {
  const response = await apiRequest<{ invoices: InvoiceData[] }>(
    `${BACKEND_API_URL}/invoices/list?limit=${limit}`,
    'GET',
    undefined,
    apiKey
  );

  if (response.success && response.data?.invoices) {
    return response.data.invoices;
  }

  return [];
};

// Delete invoice from backend
export const deleteInvoiceFromBackend = async (
  invoiceId: string,
  apiKey: string
): Promise<{ success: boolean; message: string }> => {
  const response = await apiRequest(
    `${BACKEND_API_URL}/invoices/delete/${invoiceId}`,
    'DELETE',
    undefined,
    apiKey
  );

  return {
    success: response.success,
    message: response.message,
  };
};

// Log event
export const logEventToBackend = async (
  event: {
    type: string;
    action: string;
    details?: any;
  },
  apiKey: string
): Promise<{ success: boolean; message: string }> => {
  const response = await apiRequest(
    `${BACKEND_API_URL}/logs/event`,
    'POST',
    event,
    apiKey
  );

  return {
    success: response.success,
    message: response.message,
  };
};

// Get history
export const getHistoryFromBackend = async (
  apiKey: string,
  limit: number = 100
): Promise<any[]> => {
  const response = await apiRequest<{ history: any[] }>(
    `${BACKEND_API_URL}/history?limit=${limit}`,
    'GET',
    undefined,
    apiKey
  );

  if (response.success && response.data?.history) {
    return response.data.history;
  }

  return [];
};

export default {
  authenticateBackend,
  validateApiKey,
  processDocumentWithAI,
  processBulkDocumentsWithAI,
  saveInvoiceToBackend,
  getInvoicesFromBackend,
  deleteInvoiceFromBackend,
  logEventToBackend,
  getHistoryFromBackend,
};
