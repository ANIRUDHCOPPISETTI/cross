const { kv } = require('@vercel/kv');
const { sha256Hex, isAdmin, setAdminCookie, DEFAULT_PASSWORD } = require('./_lib/util');

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({ loggedIn: isAdmin(req) });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { password } = req.body || {};
  if (typeof password !== 'string' || !password) {
    return res.status(400).json({ ok: false, error: 'Missing password' });
  }

  let hash = await kv.get('admin:hash');
  if (!hash) {
    hash = sha256Hex(DEFAULT_PASSWORD);
    await kv.set('admin:hash', hash);
  }

  if (sha256Hex(password) !== hash) {
    return res.status(401).json({ ok: false, error: 'Incorrect password' });
  }

  setAdminCookie(res);
  res.status(200).json({ ok: true });
};
