import { pool } from '../config/database.js';
import * as utils from '../utils/availability.js';

export const setupProviderRoutes = (app) => {
  // Get all providers - PUBLIC endpoint
  app.get('/api/admin/providers', async (req, res) => {
    try {
      const connection = await pool.getConnection();
      
      const [providers] = await connection.execute(
        'SELECT id, first_name, last_name, email, id_roles FROM users WHERE id_roles in (2,5)'
      );
      
      const formattedProviders = providers.map(provider => ({
        id: provider.id.toString(),
        name: `${provider.first_name} ${provider.last_name}`,
        email: provider.email,
        role: provider.id_roles === 2 ? 'provider' : 'admin-provider'
      }));

      connection.release();
      res.json(formattedProviders);
    } catch (error) {
      console.error('Error fetching providers:', error);
      res.status(500).json({ error: 'Failed to fetch providers' });
    }
  });

  // Get services for a specific provider - PUBLIC endpoint  
  app.get('/api/admin/providers/:providerId/services', async (req, res) => {
    console.log('GET /api/admin/providers/:providerId/services');
    try {
      const { providerId } = req.params;
      
      const connection = await pool.getConnection();
      
      const [services] = await connection.execute(`
        SELECT s.id, s.name, s.duration, s.price, s.description
        FROM services s
        INNER JOIN services_providers sp ON s.id = sp.id_services
        WHERE sp.id_users = ? AND s.is_private = 0
      `, [providerId]);
      
      const formattedServices = services.map(service => ({
        id: service.id.toString(),
        name: service.name,
        duration: service.duration,
        price: service.price || '0'
      }));

      connection.release();
      res.json(formattedServices);
    } catch (error) {
      console.error('Error fetching services for provider:', error);
      res.status(500).json({ error: 'Failed to fetch services' });
    }
  });

  // Get available time slots for a provider on a specific date - PUBLIC endpoint
  app.get('/api/providers/:providerId/availability', async (req, res) => {
    console.log('GET /api/providers/:providerId/availability');
    
    let connection;
    try {
      const { providerId } = req.params;
      const { serviceId, date, timezone, currentTime } = req.query;

      if (!serviceId || !date) {
        return res.status(400).json({ 
          error: 'Missing required parameters: serviceId, date' 
        });
      }

      connection = await pool.getConnection();

      // Get basic provider data
      const [providers] = await connection.execute(`
        SELECT id, first_name, last_name, timezone
        FROM users 
        WHERE id = ?
      `, [providerId]);

      if (providers.length === 0) {
        return res.status(404).json({ error: 'Provider not found' });
      }

      const provider = providers[0];

      // Get company working plan from settings
      const [workingPlanRows] = await connection.execute(`
        SELECT value FROM settings WHERE name = 'company_working_plan'
      `);

      // Get service data
      const [services] = await connection.execute(`
        SELECT id, name, duration, availabilities_type, attendants_number
        FROM services 
        WHERE id = ?
      `, [serviceId]);

      if (services.length === 0) {
        return res.status(404).json({ error: 'Service not found' });
      }

      const service = services[0];

      // Get existing appointments for this date and provider
      const [appointments] = await connection.execute(`
        SELECT start_datetime, end_datetime, is_unavailability
        FROM appointments 
        WHERE id_users_provider = ? 
        AND DATE(start_datetime) <= ? 
        AND DATE(end_datetime) >= ?
      `, [providerId, date, date]);

      // Build provider object with working plan
      const workingPlan = workingPlanRows.length > 0 ? workingPlanRows[0].value : null;
      const providerWithPlan = {
        ...provider,
        settings: {
          working_plan: workingPlan,
          working_plan_exceptions: '{}' // No exceptions for now
        }
      };

      console.log('🔍 Working plan:', workingPlan);

      // Calculate available hours
      const availableHours = utils.calculateAvailableHours(date, currentTime, timezone, service, providerWithPlan, appointments);

      res.json({
        date,
        providerId,
        serviceId,
        providerName: `${provider.first_name} ${provider.last_name}`,
        serviceName: service.name,
        serviceDuration: service.duration,
        availableHours
      });

    } catch (error) {
      console.error('Error fetching provider availability:', error);
      res.status(500).json({ error: 'Failed to fetch availability' });
    } finally {
      if (connection) connection.release();
    }
  });
};