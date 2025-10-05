import jwt from 'jsonwebtoken';
const { pool } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET;

export const validateAuthToken = (req, res) => {
  try {
    // console.log('validateAuthToken called with req type:', typeof req);
    // console.log('req object keys:', Object.keys(req || {}));
    // console.log('req.headers type:', typeof req?.headers);
    // console.log('req.headers value:', req?.headers);
    
    const authHeader = req.headers?.authorization;
    console.log('authHeader:', authHeader);

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('about to return success false, no token provided');
      return { success: false, error: 'No token provided' };
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return { success: true, user: decoded };
  } catch (error) {
    console.error('Token validation failed:', error);
    return { success: false, error: 'Failed Auth Check, Invalid Token' };
  }
};

export const validateGuestAccess = async (req) => {
  const { roomId } = req.params;
  
  try {
    const connection = await pool.getConnection();
    const [appointments] = await connection.execute(
      'SELECT id, start_datetime, end_datetime FROM appointments WHERE location = ?',
      [roomId]
    );
    connection.release();
    
    if (!Array.isArray(appointments) || appointments.length === 0) {
      return { valid: false, error: 'Invalid meeting room' };
    }
    
    const appointment = appointments[0];
    const now = new Date();
    const startTime = new Date(appointment.start_datetime);
    const endTime = new Date(appointment.end_datetime);
    
    const accessStart = new Date(startTime.getTime() - 15 * 60 * 1000);
    const accessEnd = new Date(endTime.getTime() + 120 * 60 * 1000);
    
    if (now < accessStart || now > accessEnd) {
      return { valid: false, error: 'Meeting not accessible at this time' };
    }
    
    return { valid: true };
  } catch (error) {
    console.error('Guest access validation error:', error);
    return { valid: false, error: 'Server error' };
  }
};