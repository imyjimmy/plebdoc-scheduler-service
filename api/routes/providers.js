import { pool } from '../config/database.js';
import { validateAuthToken } from '../middleware/auth.js';
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
      return res.json(formattedProviders);
    } catch (error) {
      console.error('Error fetching providers:', error);
      return res.status(500).json({ error: 'Failed to fetch providers' });
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
      return res.json(formattedServices);
    } catch (error) {
      console.error('Error fetching services for provider:', error);
      return res.status(500).json({ error: 'Failed to fetch services' });
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

      return res.json({
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
      return res.status(500).json({ error: 'Failed to fetch availability' });
    } finally {
      if (connection) connection.release();
    }
  });

  // GET provider profile PUBLIC endpoint by username
  app.get('/api/admin/provider/:username/profile', async (req, res) => {
    try {
      const { username } = req.params;
      const connection = await pool.getConnection();

      // 1. Fetch provider profile via username
      const [rows] = await connection.execute(
        `SELECT * FROM provider_profiles WHERE username = ?`,
        [username]
      );
      
      connection.release();

      if (rows.length === 0) {
        return res.status(404).json({
          status: 'error',
          message: 'Provider profile not found'
        });
      }

      // Transform snake_case to camelCase
      const profileData = rows[0];
      const camelCaseProfile = {
        userId: profileData.user_id,
        username: profileData.username,
        firstName: profileData.first_name,
        lastName: profileData.last_name,
        suffix: profileData.suffix,
        licenseNumber: profileData.license_number,
        licenseState: profileData.license_state,
        licenseIssuedDate: profileData.license_issued_date,
        licenseExpirationDate: profileData.license_expiration_date,
        registrationStatus: profileData.registration_status,
        registrationDate: profileData.registration_date,
        methodOfLicensure: profileData.method_of_licensure,
        medicalSchool: profileData.medical_school,
        graduationYear: profileData.graduation_year,
        degreeType: profileData.degree_type,
        primarySpecialty: profileData.primary_specialty,
        secondarySpecialty: profileData.secondary_specialty,
        yearOfBirth: profileData.year_of_birth,
        placeOfBirth: profileData.place_of_birth,
        gender: profileData.gender,
        bio: profileData.bio,
        createdAt: profileData.created_at,
        updatedAt: profileData.updated_at
      };

      return res.json({
        status: 'success',
        profile: camelCaseProfile
      });
      
    } catch (error) {
      console.error('Failed to load provider profile:', error);
      return res.status(500).json({
        status: 'error',
        message: 'Failed to load profile',
        error: error.message
      });
    }
  });

  // POST (insert or update) provider profile
  app.post('/api/admin/provider/profile', async (req, res) => {
    const authResult = validateAuthToken(req, res);
    if (!authResult.success) {
      return res.status(401).json({ error: authResult.error });
    }

    try {
      const { pubkey } = req.user;
      const connection = await pool.getConnection();

      // 1. Map pubkey → user_id
      const [userRows] = await connection.execute(
        `SELECT id FROM users WHERE nostr_pubkey = ? AND id_roles IN (2, 5)`,
        [pubkey]
      );
      if (userRows.length === 0) {
        connection.release();
        return res.status(404).json({ status: 'error', message: 'Provider not found' });
      }
      const userId = userRows[0].id;

      // 2. Gather fields from body (sanitize/validate in production!)
      const {
        username,
        first_name,
        last_name,
        suffix,
        license_number,
        license_state,
        license_issued_date,
        license_expiration_date,
        registration_status,
        registration_date,
        method_of_licensure,
        medical_school,
        graduation_year,
        degree_type,
        primary_specialty,
        secondary_specialty,
        year_of_birth,
        place_of_birth,
        gender,
      } = req.body;

      const toNull = (value) => value === undefined ? null : value;

      // 3. Upsert into provider_profiles
      await connection.execute(
        `
        INSERT INTO provider_profiles (
          user_id, username, first_name, last_name, suffix,
          license_number, license_state, license_issued_date, license_expiration_date,
          registration_status, registration_date, method_of_licensure,
          medical_school, graduation_year, degree_type,
          primary_specialty, secondary_specialty,
          year_of_birth, place_of_birth, gender
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          username = VALUES(username),
          first_name = VALUES(first_name),
          last_name = VALUES(last_name),
          suffix = VALUES(suffix),
          license_number = VALUES(license_number),
          license_state = VALUES(license_state),
          license_issued_date = VALUES(license_issued_date),
          license_expiration_date = VALUES(license_expiration_date),
          registration_status = VALUES(registration_status),
          registration_date = VALUES(registration_date),
          method_of_licensure = VALUES(method_of_licensure),
          medical_school = VALUES(medical_school),
          graduation_year = VALUES(graduation_year),
          degree_type = VALUES(degree_type),
          primary_specialty = VALUES(primary_specialty),
          secondary_specialty = VALUES(secondary_specialty),
          year_of_birth = VALUES(year_of_birth),
          place_of_birth = VALUES(place_of_birth),
          gender = VALUES(gender)
        `,
        [
          userId,
          toNull(username),
          toNull(first_name),
          toNull(last_name),
          toNull(suffix),
          toNull(license_number),
          toNull(license_state),
          toNull(license_issued_date),
          toNull(license_expiration_date),
          toNull(registration_status),
          toNull(registration_date),
          toNull(method_of_licensure),
          toNull(medical_school),
          toNull(graduation_year),
          toNull(degree_type),
          toNull(primary_specialty),
          toNull(secondary_specialty),
          toNull(year_of_birth),
          toNull(place_of_birth),
          toNull(gender),
        ]
      );

      connection.release();
      return res.json({ status: 'success', message: 'Profile saved successfully' });
    } catch (error) {
      console.error('Failed to save provider profile:', error);
      return res.status(500).json({
        status: 'error',
        message: 'Failed to save profile',
        error: error.message,
      });
    }
  });
};