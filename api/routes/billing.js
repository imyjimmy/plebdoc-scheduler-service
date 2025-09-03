// File: plebdoc-scheduler-service/api/routes/billing.js

import { NostrWebLNProvider } from '@getalby/sdk';
import { pool } from '../config/database.js';

class BackendBillingService {
  constructor() {
    this.activeProviders = new Map(); // providerId -> { provider, connected }
    this.activeInvoices = new Map(); // invoiceHash -> invoiceData
    this.invoiceCheckIntervals = new Map();
  }

  // Get or create Lightning provider for a specific user
  async getProviderForUser(userId) {
    if (this.activeProviders.has(userId)) {
      const providerData = this.activeProviders.get(userId);
      if (providerData.connected) {
        return providerData.provider;
      }
    }

    // Get user's NWC connection string from database
    const connection = await pool.getConnection();
    try {
      const [users] = await connection.execute(
        'SELECT nwc_connection_string FROM users WHERE id = ?',
        [userId]
      );

      if (users.length === 0 || !users[0].nwc_connection_string) {
        throw new Error('No NWC connection string found for user');
      }

      const nwcString = users[0].nwc_connection_string;
      
      // Create and connect provider
      const provider = new NostrWebLNProvider({
        nostrWalletConnectUrl: nwcString,
      });

      await provider.enable();

      this.activeProviders.set(userId, {
        provider,
        connected: true,
        connectedAt: new Date()
      });

      console.log(`💰 Connected Lightning wallet for user ${userId}`);
      return provider;

    } finally {
      connection.release();
    }
  }

  // Create invoice for appointment
  async createAppointmentInvoice(appointmentId, userId) {
    const connection = await pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Get appointment and service details
      const [appointments] = await connection.execute(`
        SELECT 
          a.id,
          a.id_services,
          a.id_users_customer,
          s.name as service_name,
          s.price as service_price,
          s.duration as service_duration,
          c.first_name as customer_first_name,
          c.last_name as customer_last_name,
          c.email as customer_email
        FROM appointments a
        JOIN services s ON a.id_services = s.id
        JOIN users c ON a.id_users_customer = c.id
        WHERE a.id = ? AND a.id_users_provider = ?
      `, [appointmentId, userId]);

      if (appointments.length === 0) {
        throw new Error('Appointment not found or not authorized');
      }

      const appointment = appointments[0];

      // Check if already invoiced
      const [existingInvoices] = await connection.execute(
        'SELECT id FROM invoices WHERE appointment_id = ?',
        [appointmentId]
      );

      if (existingInvoices.length > 0) {
        throw new Error('Appointment already invoiced');
      }

      // Get Lightning provider for user
      const provider = await this.getProviderForUser(userId);

      // Convert USD to sats (1:1 ratio)
      const amountSats = Math.floor(appointment.service_price);
      const description = `${appointment.service_name} - ${appointment.customer_first_name} ${appointment.customer_last_name}`;

      // Create Lightning invoice
      const invoice = await provider.makeInvoice({
        amount: amountSats,
        defaultMemo: description,
        expiry: 3600 // 1 hour
      });

      // Store invoice in database
      const expiresAt = new Date(Date.now() + (3600 * 1000));
      const [invoiceResult] = await connection.execute(`
        INSERT INTO invoices (
          appointment_id,
          payment_request,
          amount_sats,
          invoice_hash,
          status,
          created_at,
          expires_at
        ) VALUES (?, ?, ?, ?, 'pending', NOW(), ?)
      `, [
        appointmentId,
        invoice.paymentRequest,
        amountSats,
        invoice.payment_hash || invoice.r_hash,
        expiresAt
      ]);

      // Store active invoice for monitoring
      this.activeInvoices.set(invoice.payment_hash || invoice.r_hash, {
        appointmentId,
        userId,
        amountSats,
        description,
        createdAt: new Date(),
        expiresAt
      });

      // Start monitoring this invoice
      this.startInvoiceMonitoring(invoice.payment_hash || invoice.r_hash, userId);

      await connection.commit();

      return {
        success: true,
        invoice: {
          id: invoiceResult.insertId,
          payment_request: invoice.paymentRequest,
          amount_sats: amountSats,
          description,
          expires_at: expiresAt,
          appointment: {
            id: appointmentId,
            service_name: appointment.service_name,
            customer_name: `${appointment.customer_first_name} ${appointment.customer_last_name}`
          }
        }
      };

    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // Start monitoring invoice payments
  startInvoiceMonitoring(invoiceHash, userId) {
    const checkInterval = setInterval(async () => {
      try {
        const paid = await this.checkInvoicePayment(invoiceHash, userId);
        if (paid) {
          console.log(`✅ Invoice paid: ${invoiceHash}`);
          this.stopInvoiceMonitoring(invoiceHash);
          await this.handleInvoicePaid(invoiceHash);
        }
      } catch (error) {
        console.error(`Error checking invoice ${invoiceHash}:`, error);
      }
    }, 10000); // Check every 10 seconds

    this.invoiceCheckIntervals.set(invoiceHash, checkInterval);

    // Auto-stop after expiry
    const invoiceData = this.activeInvoices.get(invoiceHash);
    if (invoiceData) {
      setTimeout(() => {
        this.stopInvoiceMonitoring(invoiceHash);
      }, invoiceData.expiresAt.getTime() - Date.now() + 60000); // 1 minute buffer
    }
  }

  stopInvoiceMonitoring(invoiceHash) {
    const interval = this.invoiceCheckIntervals.get(invoiceHash);
    if (interval) {
      clearInterval(interval);
      this.invoiceCheckIntervals.delete(invoiceHash);
    }
  }

  // Check if invoice is paid
  async checkInvoicePayment(invoiceHash, userId) {
    try {
      const provider = await this.getProviderForUser(userId);
      
      const invoice = await provider.lookupInvoice({
        payment_hash: invoiceHash
      });

      return invoice.settled || invoice.state === 'SETTLED';
    } catch (error) {
      console.error(`Failed to check invoice payment:`, error);
      return false;
    }
  }

  // Handle paid invoice
  async handleInvoicePaid(invoiceHash) {
    const connection = await pool.getConnection();
    
    try {
      // Update invoice status in database
      await connection.execute(`
        UPDATE invoices 
        SET status = 'paid', paid_at = NOW() 
        WHERE invoice_hash = ?
      `, [invoiceHash]);

      // Remove from active monitoring
      this.activeInvoices.delete(invoiceHash);

      console.log(`💰 Invoice payment recorded: ${invoiceHash}`);
    } catch (error) {
      console.error(`Failed to handle paid invoice:`, error);
    } finally {
      connection.release();
    }
  }

  // Test NWC connection
  async testNwcConnection(nwcString) {
    try {
      const provider = new NostrWebLNProvider({
        nostrWalletConnectUrl: nwcString,
      });
      
      await provider.enable();
      
      const [walletInfo, balance] = await Promise.all([
        provider.getInfo(),
        provider.getBalance()
      ]);

      return {
        success: true,
        walletInfo: {
          node: walletInfo.node,
          balance: balance.balance
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message || 'Connection test failed'
      };
    }
  }

  // Get billing statistics
  async getBillingStats(userId) {
    const connection = await pool.getConnection();
    
    try {
      const [stats] = await connection.execute(`
        SELECT 
          COUNT(DISTINCT a.id) as total_appointments,
          COUNT(DISTINCT CASE WHEN i.id IS NULL AND a.end_datetime < NOW() THEN a.id END) as pending_invoices,
          COUNT(DISTINCT CASE WHEN i.status = 'paid' THEN i.id END) as paid_invoices,
          COALESCE(SUM(CASE WHEN i.status = 'paid' THEN i.amount_sats END), 0) as total_revenue_sats
        FROM appointments a
        LEFT JOIN invoices i ON a.id = i.appointment_id
        WHERE a.id_users_provider = ?
        AND a.status != 'cancelled'
      `, [userId]);

      return stats[0];
    } finally {
      connection.release();
    }
  }
}

// Create singleton instance
const billingService = new BackendBillingService();

// Route setup function
export const setupBillingRoutes = (app, validateAuthToken) => {

  // Create invoice for appointment
  app.post('/api/billing/appointments/:appointmentId/invoice', validateAuthToken, async (req, res) => {
    try {
      const { appointmentId } = req.params;
      const userId = req.user.id; // From JWT token

      const result = await billingService.createAppointmentInvoice(
        parseInt(appointmentId), 
        userId
      );

      res.json(result);
    } catch (error) {
      console.error('Failed to create appointment invoice:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Test NWC connection
  app.post('/api/billing/test-nwc', validateAuthToken, async (req, res) => {
    try {
      const { nwc_connection_string } = req.body;

      if (!nwc_connection_string) {
        return res.status(400).json({
          success: false,
          error: 'NWC connection string is required'
        });
      }

      const result = await billingService.testNwcConnection(nwc_connection_string);
      res.json(result);
    } catch (error) {
      console.error('Failed to test NWC connection:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Get billing statistics
  app.get('/api/billing/stats', validateAuthToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const stats = await billingService.getBillingStats(userId);
      res.json(stats);
    } catch (error) {
      console.error('Failed to get billing stats:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Get invoice status
  app.get('/api/billing/invoices/:invoiceId/status', validateAuthToken, async (req, res) => {
    try {
      const { invoiceId } = req.params;
      const connection = await pool.getConnection();
      
      const [invoices] = await connection.execute(`
        SELECT status, paid_at, expires_at 
        FROM invoices 
        WHERE id = ?
      `, [invoiceId]);
      
      connection.release();

      if (invoices.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Invoice not found'
        });
      }

      res.json({
        success: true,
        invoice: invoices[0]
      });
    } catch (error) {
      console.error('Failed to get invoice status:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
};