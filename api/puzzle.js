const { kv } = require('@vercel/kv');
const { isAdmin } = require('./_lib/util');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const date = req.query.date;
    if (!DATE_RE.test(date || '')) return res.status(400).json({ error: 'Missing or invalid date' });
    const puzzle = await kv.get(`puzzle:${date}`);
    return res.status(200).json({ puzzle: puzzle || null });
  }

  if (req.method === 'POST') {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Not logged in' });
    const { date, puzzle } = req.body || {};
    if (!DATE_RE.test(date || '') || !puzzle || typeof puzzle !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid date/puzzle' });
    }
    await kv.set(`puzzle:${date}`, puzzle);
    await kv.zadd('archive:index', { score: Number(date.replace(/-/g, '')), member: date });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Not logged in' });
    const date = req.query.date;
    if (!DATE_RE.test(date || '')) return res.status(400).json({ error: 'Missing or invalid date' });
    await kv.del(`puzzle:${date}`);
    await kv.del(`responses:${date}`);
    await kv.zrem('archive:index', date);
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  res.status(405).json({ error: 'Method not allowed' });
};
