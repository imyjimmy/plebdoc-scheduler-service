import jwt from 'jsonwebtoken';

const JWT_SECRET = 'your-secret-key'; // TODO: Move to env var

export const validateAuthToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    console.error('Token validation failed:', error);
    return res.status(401).json({ error: 'Invalid token' });
  }
};