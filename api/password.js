const { kv } = require('@vercel/kv');
const { sha256Hex, isAdmin } = require('./_lib/util');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isAdmin(req)) {
    return res.status(401).json({ ok: false, error: 'Not logged in' });
  }

  const { newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < 4) {
    return res.status(400).json({ ok: false, error: 'Password must be at least 4 characters.' });
  }

  await kv.set('admin:hash', sha256Hex(newPassword));
  res.status(200).json({ ok: true });
};
