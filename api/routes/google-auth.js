import { google } from 'googleapis';
import { GoogleAuthService } from '../services/GoogleAuthService.js';
import { authenticateSession } from '../middleware/auth.js';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';

const googleAuthService = new GoogleAuthService();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Database connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'user',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'easyappointments',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

/**
 * Helper function to get userId from authenticated session
 */
async function getUserIdFromAuth(auth, connection) {
  if (auth.user.authMethod === 'nostr') {
    const [rows] = await connection.execute(
      'SELECT id FROM users WHERE nostr_pubkey = ?',
      [auth.user.metadata.pubkey]
    );
    return rows.length > 0 ? rows[0].id : null;
  } else if (auth.user.authMethod === 'oauth') {
    return auth.user.metadata.userId;
  }
  return null;
}

export function setupGoogleRoutes(app) {
  
  // ============================================================================
  // PUBLIC ROUTES - Google Sign-In for Authentication (No Auth Required)
  // ============================================================================
  
  /**
   * Initiate Google Sign-In for provider login (no auth required)
   * GET /api/google/login/start
   */
  app.get('/api/google/login/start', async (req, res) => {
    try {
      console.log('🔍 GOOGLE_REDIRECT_URI env var:', process.env.GOOGLE_REDIRECT_URI);
      // Use a special state to indicate this is a login flow
      const state = JSON.stringify({ 
        flow: 'login',
        timestamp: Date.now() 
      });
      
      // Generate OAuth URL for login flow
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3003/api/google/login/callback'
      );

      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          // 'https://www.googleapis.com/auth/calendar',
          // 'https://www.googleapis.com/auth/calendar.events'
        ],
        prompt: 'consent',
        state: state
      });
      
      return res.json({
        success: true,
        authUrl: authUrl
      });
    } catch (error) {
      console.error('Error generating login URL:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to generate authorization URL'
      });
    }
  });

  /**
   * Handle Google OAuth callback for provider login
   * GET /api/google/login/callback
   */
  app.get('/api/google/login/callback', async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      const frontendUrl = process.env.GOOGLE_REDIRECT_URI_ADMIN || 'http://localhost:3003';

      if (error) {
        // Return 302 redirect response
        return new Response(null, {
          status: 302,
          headers: {
            'Location': `${frontendUrl}/login?error=${encodeURIComponent(error)}`
          }
        });
      }

      if (!code || !state) {
        return new Response(null, {
          status: 302,
          headers: {
            'Location': `${frontendUrl}/login?error=missing_code`
          }
        });
      }

      // Exchange code for tokens
      const tokens = await googleAuthService.getTokensFromCode(code);
      const userInfo = await googleAuthService.getUserInfo(tokens.accessToken);

      const connection = await pool.getConnection();
      
      try {
        // ... database operations ...
        
        // Generate JWT token
        const sessionToken = jwt.sign(
          {
            userId: userId,
            email: userInfo.email,
            oauthProvider: 'google',
            loginMethod: 'google'
          },
          JWT_SECRET,
          { expiresIn: '7d' }
        );

        // Redirect to frontend with token
        const callbackUrl = `${frontendUrl}/login/google-callback?token=${sessionToken}&email=${encodeURIComponent(userInfo.email)}&new_user=${isNewUser}`;
        
        return new Response(null, {
          status: 302,
          headers: {
            'Location': callbackUrl
          }
        });
        
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('OAuth login callback error:', error);
      const frontendUrl = process.env.GOOGLE_REDIRECT_URI_ADMIN || 'http://localhost:3003';
      
      return new Response(null, {
        status: 302,
        headers: {
          'Location': `${frontendUrl}/login?error=${encodeURIComponent(error.message)}`
        }
      });
    }
  });

  // ============================================================================
  // AUTHENTICATED ROUTES - Calendar Management (Auth Required)
  // ============================================================================
  
  /**
   * Generate Google OAuth URL for calendar connection (authenticated users)
   * GET /api/google/auth/url
   */
  app.get('/api/google/auth/url', async (req, res) => {
    const auth = authenticateSession(req);
    if (!auth.success) {
      return res.status(401).json({ success: false, error: auth.error });
    }

    const connection = await pool.getConnection();
    
    try {
      const userId = await getUserIdFromAuth(auth, connection);
      if (!userId) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      
      const customRedirectUri = req.query?.redirect_uri || null;
      const authUrl = googleAuthService.generateAuthUrl(userId, customRedirectUri);
      
      return res.json({
        success: true,
        authUrl: authUrl
      });
    } catch (error) {
      console.error('Error generating auth URL:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to generate authorization URL'
      });
    } finally {
      connection.release();
    }
  });

  /**
   * Handle Google OAuth callback for provider login
   * GET /api/google/login/callback
   */
  app.get('/api/google/login/callback', async (req, res) => {
    console.log('🔍 CALLBACK ROUTE HIT!');
    console.log('🔍 req.query:', req.query);

    try {
      // Use req.query - it's already parsed by createReq!
      const code = req.query.code;
      const state = req.query.state;
      const error = req.query.error;
      
      console.log('🔍 Parsed params:', { code, state, error });

      const frontendUrl = 'http://localhost:3003';

      if (error) {
        return new Response(null, {
          status: 302,
          headers: { 'Location': `${frontendUrl}/login?error=${encodeURIComponent(error)}` }
        });
      }

      if (!code || !state) {
        console.log('❌ Missing code or state');
        return new Response(null, {
          status: 302,
          headers: { 'Location': `${frontendUrl}/login?error=missing_code` }
        });
      }

      // Exchange code for tokens
      const tokens = await googleAuthService.getTokensFromCode(code);
      const userInfo = await googleAuthService.getUserInfo(tokens.accessToken);

      const connection = await pool.getConnection();
      
      try {
        // Find or create provider by email
        let [users] = await connection.execute(
          `SELECT u.id, u.first_name, u.last_name, u.email, r.slug as role 
          FROM users u 
          JOIN roles r ON u.id_roles = r.id 
          WHERE u.email = ? AND r.slug IN ('provider', 'admin-provider')`,
          [userInfo.email]
        );

        let userId;
        let isNewUser = false;
        
        if (users.length === 0) {
          // Create new provider account
          const [roleResult] = await connection.execute(
            `SELECT id FROM roles WHERE slug = 'provider'`
          );
          
          if (roleResult.length === 0) {
            throw new Error('Provider role not found');
          }

          const nameParts = userInfo.name ? userInfo.name.split(' ') : ['', ''];
          const firstName = nameParts[0] || '';
          const lastName = nameParts.slice(1).join(' ') || '';

          const [insertResult] = await connection.execute(
            `INSERT INTO users (id_roles, first_name, last_name, email, create_datetime, update_datetime)
            VALUES (?, ?, ?, ?, NOW(), NOW())`,
            [roleResult[0].id, firstName, lastName, userInfo.email]
          );
          
          userId = insertResult.insertId;
          isNewUser = true;
          
          // Create user_settings entry
          await connection.execute(
            `INSERT INTO user_settings (id_users, google_token)
            VALUES (?, ?)`,
            [userId, JSON.stringify(tokens)]
          );
        } else {
          userId = users[0].id;
          
          // Update existing provider with Google tokens
          const [settingsCheck] = await connection.execute(
            `SELECT id_users FROM user_settings WHERE id_users = ?`,
            [userId]
          );

          if (settingsCheck.length === 0) {
            await connection.execute(
              `INSERT INTO user_settings (id_users, google_token)
              VALUES (?, ?)`,
              [userId, JSON.stringify(tokens)]
            );
          } else {
            await connection.execute(
              `UPDATE user_settings 
              SET google_token = ?
              WHERE id_users = ?`,
              [JSON.stringify(tokens), userId]
            );
          }
        }

        // Generate JWT token for admin session
        const sessionToken = jwt.sign(
          {
            userId: userId,
            email: userInfo.email,
            oauthProvider: 'google',
            loginMethod: 'google'
          },
          JWT_SECRET,
          { expiresIn: '7d' }
        );

        // Redirect to frontend with token
        const callbackUrl = `${frontendUrl}/login/google-callback?token=${sessionToken}&email=${encodeURIComponent(userInfo.email)}&new_user=${isNewUser}`;
        
        return new Response(null, {
          status: 302,
          headers: { 'Location': callbackUrl }
        });
        
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('OAuth login callback error:', error);
      const frontendUrl = 'http://localhost:3003';
      
      return new Response(null, {
        status: 302,
        headers: { 'Location': `${frontendUrl}/login?error=${encodeURIComponent(error.message)}` }
      });
    }
  });
}