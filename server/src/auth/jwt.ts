import jwt from 'jsonwebtoken';
import { getConfig } from '../config.js';

export interface TokenPayload {
  userId: string;
  role: string;
}

export function signToken(userId: string, role: string = 'user'): string {
  const config = getConfig();
  return jwt.sign({ userId, role }, config.auth.jwt_secret, {
    expiresIn: config.auth.jwt_expiry as string & jwt.SignOptions['expiresIn'],
  });
}

export function verifyToken(token: string): TokenPayload {
  const config = getConfig();
  const decoded = jwt.verify(token, config.auth.jwt_secret) as jwt.JwtPayload & TokenPayload;
  return { userId: decoded.userId, role: decoded.role || 'user' };
}
