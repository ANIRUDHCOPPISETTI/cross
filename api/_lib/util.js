/* Shared helpers for the API routes. Files under api/_lib are ignored by
   Vercel's routing (underscore-prefixed folders never become endpoints). */

const crypto = require('crypto');

const ADMIN_COOKIE = 'cw_admin_session';
const DEFAULT_PASSWORD = 'admin123';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function getSecret() {
  // Set CW_SESSION_SECRET in your Vercel project's environment variables for
  // real security. Falls back to a fixed value so the app still runs without
  // it, but anyone could forge an admin session in that case.
  return process.env.CW_SESSION_SECRET || 'insecure-default-secret-change-me';
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', getSecret()).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function isAdmin(req) {
  const cookies = parseCookies(req.headers.cookie);
  const payload = verify(cookies[ADMIN_COOKIE]);
  return !!(payload && payload.role === 'admin');
}

function setAdminCookie(res) {
  const token = sign({ role: 'admin', exp: Date.now() + SESSION_TTL_MS });
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=${token}; HttpOnly; Secure; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Lax`);
}

function clearAdminCookie(res) {
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; HttpOnly; Secure; Path=/; Max-Age=0; SameSite=Lax`);
}

module.exports = { sha256Hex, isAdmin, setAdminCookie, clearAdminCookie, DEFAULT_PASSWORD };
