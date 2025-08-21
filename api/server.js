import { setupProviderRoutes } from './routes/providers.js';
import { setupAppointmentRoutes } from './routes/appointments.js';
import { setupAdminRoutes } from './routes/admin.js';
import { swaggerSpec } from './docs/swagger.js';

const PORT = process.env.PORT || 3004;

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'OK', service: 'plebdoc-appointments-service' }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // Create a simple app-like object to match Express patterns
    const app = {
      get: (path, handler) => {
        if (req.method === 'GET' && matchPath(url.pathname, path)) {
          return handler(createReq(req, url, path), createRes(corsHeaders));
        }
      },
      post: (path, handler) => {
        if (req.method === 'POST' && matchPath(url.pathname, path)) {
          return handler(createReq(req, url, path), createRes(corsHeaders));
        }
      },
      put: (path, handler) => {
        if (req.method === 'PUT' && matchPath(url.pathname, path)) {
          return handler(createReq(req, url, path), createRes(corsHeaders));
        }
      },
      delete: (path, handler) => {
        if (req.method === 'DELETE' && matchPath(url.pathname, path)) {
          return handler(createReq(req, url, path), createRes(corsHeaders));
        }
      }
    };

    // Setup routes
    setupProviderRoutes(app);
    setupAppointmentRoutes(app);
    setupAdminRoutes(app);

    // Serve Swagger JSON spec
    if (url.pathname === '/api-docs.json') {
      return new Response(JSON.stringify(swaggerSpec), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
    
    // If no route matched, return 404
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
});

console.log(`🚀 Plebdoc Appointments Service running on port ${PORT}`);

// Helper functions to create Express-like req/res objects
function matchPath(pathname, pattern) {
  // Simple pattern matching - you might want to use a proper router library
  if (pattern.includes(':')) {
    const patternParts = pattern.split('/');
    const pathnameParts = pathname.split('/');
    
    if (patternParts.length !== pathnameParts.length) return false;
    
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) continue;
      if (patternParts[i] !== pathnameParts[i]) return false;
    }
    return true;
  }
  return pathname === pattern;
}

function createReq(req, url, pattern) {
  const params = {};
  
  // Extract params from URL
  if (pattern.includes(':')) {
    const patternParts = pattern.split('/');
    const pathnameParts = url.pathname.split('/');
    
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        const paramName = patternParts[i].substring(1);
        params[paramName] = pathnameParts[i];
      }
    }
  }

  return {
    params,
    query: Object.fromEntries(url.searchParams),
    headers: Object.fromEntries(req.headers.entries()),
    body: req.body,
    json: () => req.json()
  };
}

function createRes(corsHeaders) {
  return {
    json: (data) => {
      return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    },
    status: (code) => ({
      json: (data) => {
        return new Response(JSON.stringify(data), {
          status: code,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    })
  };
}