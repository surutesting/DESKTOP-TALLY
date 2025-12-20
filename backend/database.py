import sqlite3
import json
import os
from datetime import datetime
from typing import List, Dict, Any, Optional
from contextlib import contextmanager

# Database file location
DB_PATH = os.getenv("DATABASE_PATH", "./autotally.db")

@contextmanager
def get_db():
    """Context manager for database connections"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # Return rows as dictionaries
    try:
        yield conn
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()


def init_database():
    """Initialize database tables"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Invoices table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS invoices (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                invoice_number TEXT,
                supplier_name TEXT,
                buyer_name TEXT,
                invoice_date TEXT,
                total_amount REAL,
                status TEXT,
                data TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Logs table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS logs (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                event_type TEXT,
                method TEXT,
                endpoint TEXT,
                status TEXT,
                message TEXT,
                response TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Create indexes
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(created_at)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_logs_user ON logs(user_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_logs_date ON logs(created_at)")
        
        conn.commit()
        print("Database initialized successfully")


# Invoice CRUD operations
def save_invoice(invoice_id: str, user_id: str, invoice_data: Dict[str, Any], status: str = "Ready") -> bool:
    """Save or update an invoice"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Extract key fields
            invoice_number = invoice_data.get('invoiceNumber', '')
            supplier_name = invoice_data.get('supplierName', '')
            buyer_name = invoice_data.get('buyerName', '')
            invoice_date = invoice_data.get('invoiceDate', '')
            
            # Calculate total amount
            total_amount = 0.0
            for item in invoice_data.get('lineItems', []):
                total_amount += item.get('amount', 0)
            
            # Check if invoice exists
            cursor.execute("SELECT id FROM invoices WHERE id = ?", (invoice_id,))
            exists = cursor.fetchone()
            
            if exists:
                # Update existing
                cursor.execute("""
                    UPDATE invoices 
                    SET invoice_number = ?, supplier_name = ?, buyer_name = ?, 
                        invoice_date = ?, total_amount = ?, status = ?, 
                        data = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """, (invoice_number, supplier_name, buyer_name, invoice_date, 
                      total_amount, status, json.dumps(invoice_data), invoice_id))
            else:
                # Insert new
                cursor.execute("""
                    INSERT INTO invoices 
                    (id, user_id, invoice_number, supplier_name, buyer_name, 
                     invoice_date, total_amount, status, data)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (invoice_id, user_id, invoice_number, supplier_name, buyer_name,
                      invoice_date, total_amount, status, json.dumps(invoice_data)))
            
            return True
    except Exception as e:
        print(f"Error saving invoice: {e}")
        return False


def get_invoices(user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    """Get list of invoices for a user"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, invoice_number, supplier_name, buyer_name, 
                       invoice_date, total_amount, status, data, created_at
                FROM invoices 
                WHERE user_id = ?
                ORDER BY created_at DESC
                LIMIT ?
            """, (user_id, limit))
            
            rows = cursor.fetchall()
            invoices = []
            for row in rows:
                invoice = dict(row)
                # Parse JSON data
                if invoice['data']:
                    invoice['data'] = json.loads(invoice['data'])
                invoices.append(invoice)
            
            return invoices
    except Exception as e:
        print(f"Error getting invoices: {e}")
        return []


def delete_invoice(invoice_id: str, user_id: str) -> bool:
    """Delete an invoice"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM invoices WHERE id = ? AND user_id = ?", 
                          (invoice_id, user_id))
            return cursor.rowcount > 0
    except Exception as e:
        print(f"Error deleting invoice: {e}")
        return False


# Log operations
def save_log(log_id: str, user_id: str, log_data: Dict[str, Any]) -> bool:
    """Save a log entry"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO logs 
                (id, user_id, event_type, method, endpoint, status, message, response)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                log_id,
                user_id,
                log_data.get('event_type', 'general'),
                log_data.get('method', ''),
                log_data.get('endpoint', ''),
                log_data.get('status', ''),
                log_data.get('message', ''),
                log_data.get('response', '')
            ))
            return True
    except Exception as e:
        print(f"Error saving log: {e}")
        return False


def get_history(user_id: str, limit: int = 100) -> List[Dict[str, Any]]:
    """Get event history for a user"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, event_type, method, endpoint, status, message, response, created_at
                FROM logs 
                WHERE user_id = ?
                ORDER BY created_at DESC
                LIMIT ?
            """, (user_id, limit))
            
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
    except Exception as e:
        print(f"Error getting history: {e}")
        return []


# Initialize database on module import
init_database()
