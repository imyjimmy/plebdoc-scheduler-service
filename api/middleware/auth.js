import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

export const validateAuthToken = (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return { success: true };
  } catch (error) {
    console.error('Token validation failed:', error);
    return res.status(401).json({ error: 'Invalid token' });
  }
};