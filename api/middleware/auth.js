import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

export const validateAuthToken = (req, res) => {
  try {
    console.log('validateAuthToken called with req type:', typeof req);
    console.log('req object keys:', Object.keys(req || {}));
    console.log('req.headers type:', typeof req?.headers);
    console.log('req.headers value:', req?.headers);
    
    const authHeader = req.headers?.authorization;
    console.log('authHeader:', authHeader);

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { success: false, error: 'No token provided' };
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return { success: true, user: decoded };
  } catch (error) {
    console.error('Token validation failed:', error);
    return { success: false, error: 'Invalid token' };
  }
};