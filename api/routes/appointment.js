import { pool } from '../config/database.js';
import { validateEvent, verifyEvent } from 'nostr-tools/pure';
import * as utils from '../utils/availability.js';
import { validateAuthToken } from '../middleware/auth.js';

// In-memory cache for login tokens (consider Redis for production)
const loginTokenCache = new Map();

const generateLoginToken = (pubkey) => {
  const token = Math.random().toString(36).substring(2, 15);
  loginTokenCache.set(token, {
    nostrPubkey: pubkey,
    expires: Date.now() + (5 * 60 * 1000) // 5 minutes
  });
  return token;
};

export const setupAppointmentRoutes = (app) => {
  // Create an appointment with Nostr signature verification
  app.post('/api/appointments/verify-booking', async (req, res) => {
    const { bookingData, signedEvent } = req.body;
  
    try {
      console.log('=== BOOKING VERIFICATION DEBUG ===');
      console.log('Received bookingData:', JSON.stringify(bookingData, null, 2));
      console.log('Received signedEvent:', JSON.stringify(signedEvent, null, 2));
      
      // 1. Verify the Nostr event signature
      if (!validateEvent(signedEvent) || !verifyEvent(signedEvent)) {
        console.log('❌ Signature validation failed');
        return res.status(400).json({ 
          status: 'error', 
          reason: 'Invalid signature' 
        });
      }
      console.log('✅ Signature validation passed');

      // 2. Verify the signed content matches the booking data
      const expectedContent = JSON.stringify(bookingData);
      console.log('Expected content:', expectedContent);
      console.log('Signed content:', signedEvent.content);
      console.log('Contents match:', expectedContent === signedEvent.content);
      
      if (signedEvent.content !== expectedContent) {
        console.log('❌ Content mismatch detected');
        return res.status(400).json({ 
          status: 'error', 
          reason: 'Signed content does not match booking data' 
        });
      }
      console.log('✅ Content verification passed');
      console.log('signedEvent pubkey bech32: ', utils.hexToBech32(signedEvent.pubkey));

      // 3. Create appointment using connection pool
      const connection = await pool.getConnection();
      
      try {
        await connection.beginTransaction();

        // First, check if customer exists or create one
        let customerId;
        const [existingCustomers] = await connection.execute(
          'SELECT u.id FROM users u JOIN roles r ON u.id_roles = r.id WHERE u.nostr_pubkey = ? AND r.slug = "customer"',
          [signedEvent.pubkey]
        );

        if (existingCustomers.length > 0) {
          customerId = existingCustomers[0].id;
          console.log(`✅ Found existing customer with ID: ${customerId}`);
        } else {
          console.log('🆕 Creating new customer user');
          // Create new customer user
          const [customerRole] = await connection.execute(
            'SELECT id FROM roles WHERE slug = "customer"'
          );
          
          if (customerRole.length === 0) {
            throw new Error('Customer role not found');
          }

          const [customerResult] = await connection.execute(
            `INSERT INTO users (id_roles, first_name, last_name, email, phone_number, nostr_pubkey, create_datetime, update_datetime) 
            VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
              customerRole[0].id,
              bookingData.patientInfo.firstName,
              bookingData.patientInfo.lastName,
              bookingData.patientInfo.email || null,
              bookingData.patientInfo.phone || null,
              signedEvent.pubkey
            ]
          );
          
          customerId = customerResult.insertId;
          console.log(`✅ Created new customer with ID: ${customerId}`);
        }

        // Get service duration for end_datetime calculation
        const [serviceResult] = await connection.execute(
          'SELECT duration FROM services WHERE id = ?',
          [bookingData.serviceId]
        );
        
        if (serviceResult.length === 0) {
          throw new Error('Service not found');
        }

        const durationMinutes = serviceResult[0].duration;
        const startTime = new Date(bookingData.startTime);
        const endTime = new Date(startTime.getTime() + (durationMinutes * 60000));

        // Create appointment
        const [appointmentResult] = await connection.execute(
          `INSERT INTO appointments (
            id_users_provider, id_users_customer, id_services, 
            start_datetime, end_datetime, notes, 
            book_datetime, create_datetime, update_datetime, hash, location
          ) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW(), ?, ?)`,
          [
            bookingData.providerId,
            customerId,
            bookingData.serviceId,
            startTime.toISOString().slice(0, 19).replace('T', ' '),
            endTime.toISOString().slice(0, 19).replace('T', ' '),
            bookingData.patientInfo.notes || null,
            Math.random().toString(36).substring(7), // Simple hash,
            utils.generateRoomId()
          ]
        );

        await connection.commit();

        res.json({ 
          status: 'OK',
          appointmentId: appointmentResult.insertId,
          message: 'Appointment created successfully'
        });
        
      } catch (dbError) {
        await connection.rollback();
        throw dbError;
      } finally {
        connection.release();
      }
      
    } catch (error) {
      console.error('Booking verification error:', error);
      res.status(500).json({ 
        status: 'error', 
        reason: error.message || 'Verification failed' 
      });
    }
  });

  // Generate auto-login URL for dashboard
  app.post('/api/appointments/dashboard-login', validateAuthToken, async (req, res) => {
    try {
      const { pubkey } = req.user; // From validated JWT
      
      // Create a one-time login token for the handoff
      const loginToken = generateLoginToken(pubkey);
      
      // Return the login URL
      const loginUrl = `/providers_nostr/nostr_login?token=${loginToken}`;
      
      res.json({
        success: true,
        loginUrl: loginUrl
      });
      
    } catch (error) {
      console.error('Dashboard login error:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Internal server error' 
      });
    }
  });

  // Validate login token
  app.post('/api/appointments/validate-login-token', async (req, res) => {
    try {
      const { token } = req.body;
      
      const tokenData = loginTokenCache.get(token);
      if (!tokenData || tokenData.expires < Date.now()) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      // Remove token (one-time use)
      loginTokenCache.delete(token);

      // Get provider's credentials
      const connection = await pool.getConnection();
      
      const [rows] = await connection.execute(
        'SELECT id, email, first_name, last_name FROM users WHERE nostr_pubkey = ? AND id_roles = 2',
        [tokenData.nostrPubkey]
      );
      
      connection.release();
      
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Provider not found' });
      }

      res.json({
        success: true,
        provider: {
          id: rows[0].id,
          email: rows[0].email,
          firstName: rows[0].first_name,
          lastName: rows[0].last_name
        }
      });

    } catch (error) {
      console.error('Token validation error:', error);
      res.status(500).json({ error: 'Token validation failed' });
    }
  });
};