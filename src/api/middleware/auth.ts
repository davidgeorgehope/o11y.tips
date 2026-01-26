import { Context, Next } from 'hono';
import * as jose from 'jose';
import { config } from '../../config.js';

const encoder = new TextEncoder();

export async function adminAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    return c.json({ error: 'Authorization required' }, 401);
  }

  // Support Bearer token (JWT)
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);

    try {
      const secret = encoder.encode(config.admin.jwtSecret);
      const { payload } = await jose.jwtVerify(token, secret);

      // Add user info to context
      c.set('user', payload);
      await next();
      return;
    } catch {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }
  }

  // Support Basic auth for initial login
  if (authHeader.startsWith('Basic ')) {
    const base64Credentials = authHeader.slice(6);
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
    const [username, password] = credentials.split(':');

    if (username === config.admin.username && password === config.admin.password) {
      await next();
      return;
    }
  }

  return c.json({ error: 'Invalid credentials' }, 401);
}

export async function generateToken(username: string): Promise<string> {
  const secret = encoder.encode(config.admin.jwtSecret);

  const token = await new jose.SignJWT({ username, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(config.admin.jwtExpiresIn)
    .sign(secret);

  return token;
}

export async function verifyToken(token: string): Promise<jose.JWTPayload | null> {
  try {
    const secret = encoder.encode(config.admin.jwtSecret);
    const { payload } = await jose.jwtVerify(token, secret);
    return payload;
  } catch {
    return null;
  }
}
