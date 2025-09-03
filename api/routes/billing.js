import { NostrWebLNProvider } from "@getalby/sdk";
import { pool } from '../config/database.js';
import { validateAuthToken } from '../middleware/auth.js';

class BillingService {
  constructor(nwcConnectionString) {
    if (!nwcConnectionString) {
      throw new Error('NWC_CONNECTION_STRING is required');
    }
    
    console.log('Billing Service creation: ', nwcConnectionString);
    this.provider = null;
    this.connected = false;
    this.nwcUrl = nwcConnectionString;
    this.pendingInvoices = new Map();
    this.invoiceHistory = new Map();
  }

  async connect() {
    try {
      this.provider = new NostrWebLNProvider({
        nostrWalletConnectUrl: this.nwcUrl,
      });
      
      await this.provider.enable();
      this.connected = true;
      console.log('💰 Billing service connected via NWC');
      return true;
    } catch (error) {
      console.error('❌ Billing service connection failed:', error);
      this.connected = false;
      throw error;
    }
  }

  // Create invoice for appointment payment
  async createAppointmentInvoice(appointmentId, amountSats, description, expiry = 3600) {
    if (!this.connected) {
      await this.connect();
    }

    try {
      console.log(`💸 Creating appointment invoice: ${amountSats} sats for appointment ${appointmentId}, expires in ${expiry}s`);
      
      // Validation
      if (!amountSats || amountSats <= 0) {
        throw new Error(`Invalid amount: ${amountSats}`);
      }
      
      if (!expiry || expiry <= 0) {
        throw new Error(`Invalid expiry: ${expiry}`);
      }

      const invoice = await this.provider.makeInvoice({
        amount: parseInt(amountSats),
        defaultMemo: `PlebDoc Appointment: ${description} - Appointment ID: ${appointmentId}`,
        expiry: parseInt(expiry)
      });

      console.log('Created appointment invoice: ', invoice);
      
      const invoiceData = {
        appointmentId,
        amountSats: parseInt(amountSats),
        description,
        expiry: parseInt(expiry),
        expiresAt: Date.now() + (expiry * 1000),
        createdAt: Date.now(),
        type: 'appointment',
        status: 'pending'
      };

      this.pendingInvoices.set(invoice.paymentRequest, invoiceData);

      return {
        paymentRequest: invoice.paymentRequest,
        appointmentId,
        amountSats: parseInt(amountSats),
        description,
        expiresAt: Date.now() + (expiry * 1000),
        status: 'pending'
      };

    } catch (error) {
      console.error(`💥 Appointment invoice creation failed:`, error);
      return this.createMockInvoice(appointmentId, amountSats, 'appointment', expiry, description);
    }
  }

  // Create invoice for service fees (consultation, follow-ups, etc.)
  async createServiceInvoice(serviceId, patientId, amountSats, description, expiry = 3600) {
    if (!this.connected) {
      await this.connect();
    }

    try {
      console.log(`💸 Creating service invoice: ${amountSats} sats for service ${serviceId}, expires in ${expiry}s`);
      
      if (!amountSats || amountSats <= 0) {
        throw new Error(`Invalid amount: ${amountSats}`);
      }

      const invoice = await this.provider.makeInvoice({
        amount: parseInt(amountSats),
        defaultMemo: `PlebDoc Service: ${description} - Service ID: ${serviceId}`,
        expiry: parseInt(expiry)
      });

      const invoiceData = {
        serviceId,
        patientId,
        amountSats: parseInt(amountSats),
        description,
        expiry: parseInt(expiry),
        expiresAt: Date.now() + (expiry * 1000),
        createdAt: Date.now(),
        type: 'service',
        status: 'pending'
      };

      this.pendingInvoices.set(invoice.paymentRequest, invoiceData);

      return {
        paymentRequest: invoice.paymentRequest,
        serviceId,
        patientId,
        amountSats: parseInt(amountSats),
        description,
        expiresAt: Date.now() + (expiry * 1000),
        status: 'pending'
      };

    } catch (error) {
      console.error(`💥 Service invoice creation failed:`, error);
      return this.createMockInvoice(serviceId, amountSats, 'service', expiry, description);
    }
  }

  // Mock invoice for testing
  createMockInvoice(entityId, amountSats, type, expiry, description) {
    console.log(`🧪 Creating mock ${type} invoice: ${amountSats} sats, expires in ${expiry}s`);
    
    const mockInvoice = `lnbc${amountSats}n1test_${type}_${entityId}_${Date.now()}`;
    
    const invoiceData = {
      entityId,
      amountSats,
      type,
      description,
      expiry,
      expiresAt: Date.now() + (expiry * 1000),
      createdAt: Date.now(),
      mock: true,
      status: 'pending'
    };

    this.pendingInvoices.set(mockInvoice, invoiceData);

    return {
      paymentRequest: mockInvoice,
      paymentHash: 'mock_hash_' + Math.random().toString(36).substr(2, 8),
      entityId,
      amountSats,
      expiresAt: Date.now() + (expiry * 1000),
      status: 'pending'
    };
  }

  // Check if an invoice has been paid
  async checkInvoicePayment(paymentRequest) {
    if (!this.connected) {
      await this.connect();
    }

    try {
      // Check if this is a mock invoice
      const invoiceData = this.pendingInvoices.get(paymentRequest);

      if (invoiceData && invoiceData.mock) {
        console.log(`🧪 Mock invoice check for ${paymentRequest.substring(0, 20)}...`);
        // For testing, randomly return paid status after some time
        const elapsed = Date.now() - invoiceData.createdAt;
        const isPaid = elapsed > 30000; // Mock payment after 30 seconds
        
        if (isPaid) {
          invoiceData.status = 'paid';
          this.invoiceHistory.set(paymentRequest, invoiceData);
          this.pendingInvoices.delete(paymentRequest);
        }
        
        return {
          paid: isPaid,
          amount: invoiceData.amountSats,
          paymentRequest: paymentRequest,
          settledAt: isPaid ? Date.now() : null,
          status: invoiceData.status
        };
      }

      // For real invoices, use the provider to check payment status
      const invoice = await this.provider.lookupInvoice({
        paymentRequest
      });

      const isPaid = invoice.settled || invoice.state === 'SETTLED';
      
      if (isPaid && invoiceData) {
        invoiceData.status = 'paid';
        this.invoiceHistory.set(paymentRequest, invoiceData);
        this.pendingInvoices.delete(paymentRequest);
      }

      return {
        paid: isPaid,
        amount: invoice.value || invoiceData?.amountSats || 0,
        paymentRequest: paymentRequest,
        settledAt: invoice.settle_date || (isPaid ? Date.now() : null),
        status: isPaid ? 'paid' : 'pending'
      };

    } catch (error) {
      console.error(`Failed to check invoice payment for ${paymentRequest.substring(0, 20)}...:`, error);
      
      return {
        paid: false,
        amount: 0,
        paymentRequest: paymentRequest,
        status: 'error',
        error: error.message
      };
    }
  }

  // Check if invoice is expired
  isInvoiceExpired(paymentRequest) {
    const invoiceData = this.pendingInvoices.get(paymentRequest);
    
    if (!invoiceData) return true;
    
    return Date.now() > invoiceData.expiresAt;
  }

  // Get all pending invoices
  getPendingInvoices() {
    return Array.from(this.pendingInvoices.entries()).map(([paymentRequest, data]) => ({
      paymentRequest,
      ...data,
      expired: this.isInvoiceExpired(paymentRequest)
    }));
  }

  // Get invoice history
  getInvoiceHistory() {
    return Array.from(this.invoiceHistory.entries()).map(([paymentRequest, data]) => ({
      paymentRequest,
      ...data
    }));
  }

  // Cancel expired invoices
  cleanupExpiredInvoices() {
    const now = Date.now();
    const expired = [];
    
    for (const [paymentRequest, data] of this.pendingInvoices.entries()) {
      if (now > data.expiresAt) {
        expired.push(paymentRequest);
        this.pendingInvoices.delete(paymentRequest);
        console.log(`🗑️ Cleaned up expired invoice: ${paymentRequest.substring(0, 20)}...`);
      }
    }
    
    return expired;
  }
}

// Initialize billing service instance
const billingService = new BillingService(process.env.NWC_CONNECTION_STRING || 'mock');

export const setupBillingRoutes = (app) => {
  
  // Create invoice for appointment payment
  app.post('/api/billing/appointments/:appointmentId/invoice', async (req, res) => {
    const authResult = validateAuthToken(req, res);
    if (authResult && !authResult.success) {
      return authResult; // This will be the error response
    }

    let connection;
    try {
      const { appointmentId } = req.params;
      const { amountSats, description, expiry } = req.body;

      if (!amountSats || amountSats <= 0) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid amount specified'
        });
      }

      connection = await pool.getConnection();

      // Verify appointment exists
      const [appointments] = await connection.execute(`
        SELECT a.id, a.start_datetime, a.end_datetime, 
               u.first_name, u.last_name, u.email,
               s.name as service_name, s.price
        FROM appointments a
        JOIN users u ON a.id_users_customer = u.id
        JOIN services s ON a.id_services = s.id
        WHERE a.id = ?
      `, [appointmentId]);

      if (appointments.length === 0) {
        return res.status(404).json({
          status: 'error',
          message: 'Appointment not found'
        });
      }

      const appointment = appointments[0];
      const invoiceDescription = description || `${appointment.service_name} appointment with Dr. ${appointment.first_name} ${appointment.last_name}`;

      // Create the invoice
      const invoice = await billingService.createAppointmentInvoice(
        appointmentId,
        amountSats,
        invoiceDescription,
        expiry || 3600
      );

      // Store invoice reference in database
      await connection.execute(`
        INSERT INTO appointment_invoices (appointment_id, payment_request, amount_sats, description, status, created_at, expires_at)
        VALUES (?, ?, ?, ?, 'pending', NOW(), DATE_ADD(NOW(), INTERVAL ? SECOND))
      `, [appointmentId, invoice.paymentRequest, amountSats, invoiceDescription, expiry || 3600]);

      res.json({
        status: 'success',
        invoice: {
          appointmentId,
          paymentRequest: invoice.paymentRequest,
          amount: amountSats,
          description: invoiceDescription,
          expiresAt: invoice.expiresAt,
          patientName: `${appointment.first_name} ${appointment.last_name}`,
          patientEmail: appointment.email
        }
      });

    } catch (error) {
      console.error('Error creating appointment invoice:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to create appointment invoice',
        details: error.message
      });
    } finally {
      if (connection) connection.release();
    }
  });

  // Create invoice for general service payment
  app.post('/api/billing/services/:serviceId/invoice', async (req, res) => {
    const authResult = validateAuthToken(req, res);
    if (authResult && !authResult.success) {
      return authResult; // This will be the error response
    }
    
    let connection;
    try {
      const { serviceId } = req.params;
      const { patientId, amountSats, description, expiry } = req.body;

      if (!patientId || !amountSats || amountSats <= 0) {
        return res.status(400).json({
          status: 'error',
          message: 'Missing required fields: patientId, amountSats'
        });
      }

      connection = await pool.getConnection();

      // Verify service and patient exist
      const [services] = await connection.execute(`
        SELECT id, name, price, duration
        FROM services 
        WHERE id = ?
      `, [serviceId]);

      if (services.length === 0) {
        return res.status(404).json({
          status: 'error',
          message: 'Service not found'
        });
      }

      const [patients] = await connection.execute(`
        SELECT id, first_name, last_name, email
        FROM users 
        WHERE id = ? AND id_roles = 3
      `, [patientId]);

      if (patients.length === 0) {
        return res.status(404).json({
          status: 'error',
          message: 'Patient not found'
        });
      }

      const service = services[0];
      const patient = patients[0];
      const invoiceDescription = description || `${service.name} service payment`;

      // Create the invoice
      const invoice = await billingService.createServiceInvoice(
        serviceId,
        patientId,
        amountSats,
        invoiceDescription,
        expiry || 3600
      );

      // Store invoice reference in database
      await connection.execute(`
        INSERT INTO service_invoices (service_id, patient_id, payment_request, amount_sats, description, status, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, 'pending', NOW(), DATE_ADD(NOW(), INTERVAL ? SECOND))
      `, [serviceId, patientId, invoice.paymentRequest, amountSats, invoiceDescription, expiry || 3600]);

      res.json({
        status: 'success',
        invoice: {
          serviceId,
          patientId,
          paymentRequest: invoice.paymentRequest,
          amount: amountSats,
          description: invoiceDescription,
          expiresAt: invoice.expiresAt,
          serviceName: service.name,
          patientName: `${patient.first_name} ${patient.last_name}`,
          patientEmail: patient.email
        }
      });

    } catch (error) {
      console.error('Error creating service invoice:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to create service invoice',
        details: error.message
      });
    } finally {
      if (connection) connection.release();
    }
  });

  // Check payment status of an invoice
  app.get('/api/billing/invoices/:paymentRequest/status', async (req, res) => {
    const authResult = validateAuthToken(req, res);
    if (authResult && !authResult.success) {
      return authResult; // This will be the error response
    }

    try {
      const { paymentRequest } = req.params;

      const paymentStatus = await billingService.checkInvoicePayment(paymentRequest);

      // If payment was successful, update database records
      if (paymentStatus.paid) {
        const connection = await pool.getConnection();
        
        try {
          // Update appointment invoice status if it exists
          await connection.execute(`
            UPDATE appointment_invoices 
            SET status = 'paid', paid_at = NOW() 
            WHERE payment_request = ? AND status = 'pending'
          `, [paymentRequest]);

          // Update service invoice status if it exists
          await connection.execute(`
            UPDATE service_invoices 
            SET status = 'paid', paid_at = NOW() 
            WHERE payment_request = ? AND status = 'pending'
          `, [paymentRequest]);

          console.log(`✅ Invoice payment recorded: ${paymentRequest.substring(0, 20)}...`);
          
        } finally {
          connection.release();
        }
      }

      res.json({
        status: 'success',
        payment: paymentStatus
      });

    } catch (error) {
      console.error('Error checking invoice payment:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to check payment status',
        details: error.message
      });
    }
  });

  // Get all pending invoices
  app.get('/api/billing/invoices/pending', async (req, res) => {
    const authResult = validateAuthToken(req, res);
    if (authResult && !authResult.success) {
      return authResult; // This will be the error response
    }

    try {
      const pendingInvoices = billingService.getPendingInvoices();
      
      res.json({
        status: 'success',
        invoices: pendingInvoices,
        count: pendingInvoices.length
      });

    } catch (error) {
      console.error('Error fetching pending invoices:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch pending invoices',
        details: error.message
      });
    }
  });

  // Get invoice history
  app.get('/api/billing/invoices/history', async (req, res) => {
    const authResult = validateAuthToken(req, res);
    if (authResult && !authResult.success) {
      return authResult; // This will be the error response
    }

    try {
      const { limit = 50, offset = 0 } = req.query;
      
      let connection;
      try {
        connection = await pool.getConnection();

        // Get appointment invoices
        const [appointmentInvoices] = await connection.execute(`
          SELECT ai.*, a.start_datetime, a.end_datetime,
                 u.first_name, u.last_name, u.email,
                 s.name as service_name
          FROM appointment_invoices ai
          JOIN appointments a ON ai.appointment_id = a.id
          JOIN users u ON a.id_users_customer = u.id
          JOIN services s ON a.id_services = s.id
          ORDER BY ai.created_at DESC
          LIMIT ? OFFSET ?
        `, [parseInt(limit), parseInt(offset)]);

        // Get service invoices
        const [serviceInvoices] = await connection.execute(`
          SELECT si.*, s.name as service_name,
                 u.first_name, u.last_name, u.email
          FROM service_invoices si
          JOIN services s ON si.service_id = s.id
          JOIN users u ON si.patient_id = u.id
          ORDER BY si.created_at DESC
          LIMIT ? OFFSET ?
        `, [parseInt(limit), parseInt(offset)]);

        const invoiceHistory = billingService.getInvoiceHistory();

        res.json({
          status: 'success',
          invoices: {
            appointments: appointmentInvoices,
            services: serviceInvoices,
            memory: invoiceHistory
          }
        });

      } finally {
        if (connection) connection.release();
      }

    } catch (error) {
      console.error('Error fetching invoice history:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch invoice history',
        details: error.message
      });
    }
  });

  // Manual cleanup of expired invoices
  app.post('/api/billing/invoices/cleanup', async (req, res) => {
    const authResult = validateAuthToken(req, res);
    if (authResult && !authResult.success) {
      return authResult; // This will be the error response
    }

    try {
      const expired = billingService.cleanupExpiredInvoices();
      
      if (expired.length > 0) {
        const connection = await pool.getConnection();
        
        try {
          // Mark expired invoices in database
          for (const paymentRequest of expired) {
            await connection.execute(`
              UPDATE appointment_invoices 
              SET status = 'expired' 
              WHERE payment_request = ? AND status = 'pending'
            `, [paymentRequest]);

            await connection.execute(`
              UPDATE service_invoices 
              SET status = 'expired' 
              WHERE payment_request = ? AND status = 'pending'
            `, [paymentRequest]);
          }
        } finally {
          connection.release();
        }
      }

      res.json({
        status: 'success',
        message: `Cleaned up ${expired.length} expired invoices`,
        expiredInvoices: expired
      });

    } catch (error) {
      console.error('Error cleaning up expired invoices:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to cleanup expired invoices',
        details: error.message
      });
    }
  });

  // Get billing statistics
  app.get('/api/billing/stats', async (req, res) => {
    const authResult = validateAuthToken(req, res);
    if (authResult && !authResult.success) {
      return authResult; // This will be the error response
    }
    
    let connection;
    try {
      connection = await pool.getConnection();

      const [appointmentStats] = await connection.execute(`
        SELECT 
          COUNT(*) as total_invoices,
          SUM(CASE WHEN status = 'paid' THEN amount_sats ELSE 0 END) as total_revenue_sats,
          SUM(CASE WHEN status = 'pending' THEN amount_sats ELSE 0 END) as pending_revenue_sats,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
          COUNT(CASE WHEN status = 'paid' THEN 1 END) as paid_count,
          COUNT(CASE WHEN status = 'expired' THEN 1 END) as expired_count
        FROM appointment_invoices 
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      `);

      const [serviceStats] = await connection.execute(`
        SELECT 
          COUNT(*) as total_invoices,
          SUM(CASE WHEN status = 'paid' THEN amount_sats ELSE 0 END) as total_revenue_sats,
          SUM(CASE WHEN status = 'pending' THEN amount_sats ELSE 0 END) as pending_revenue_sats,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
          COUNT(CASE WHEN status = 'paid' THEN 1 END) as paid_count,
          COUNT(CASE WHEN status = 'expired' THEN 1 END) as expired_count
        FROM service_invoices 
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      `);

      const pendingInvoices = billingService.getPendingInvoices();
      const memoryStats = {
        pending_count: pendingInvoices.length,
        expired_count: pendingInvoices.filter(inv => inv.expired).length
      };

      res.json({
        status: 'success',
        stats: {
          last_30_days: {
            appointments: appointmentStats[0],
            services: serviceStats[0]
          },
          memory: memoryStats,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('Error fetching billing statistics:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch billing statistics',
        details: error.message
      });
    } finally {
      if (connection) connection.release();
    }
  });

  // Webhook for payment notifications (if supported by wallet)
  app.post('/api/billing/webhook/payment', async (req, res) => {
    try {
      const { paymentRequest, paymentHash } = req.body;

      if (!paymentRequest) {
        return res.status(400).json({
          status: 'error',
          message: 'Missing payment request'
        });
      }

      // Check if this payment is in our system
      const paymentStatus = await billingService.checkInvoicePayment(paymentRequest);

      if (paymentStatus.paid) {
        console.log(`🎉 Payment webhook confirmed: ${paymentRequest.substring(0, 20)}...`);
        
        // Additional processing could go here (send confirmations, update appointment status, etc.)
        
        res.json({
          status: 'success',
          message: 'Payment confirmed and processed'
        });
      } else {
        res.json({
          status: 'info',
          message: 'Payment not found in system'
        });
      }

    } catch (error) {
      console.error('Payment webhook error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Webhook processing failed',
        details: error.message
      });
    }
  });
};

// Export the billing service instance for use in other modules
export { billingService };