const { kv } = require('@vercel/kv');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_STORED = 200; // keep the fastest 200 finishers per puzzle; plenty for a Top 5 leaderboard

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const date = req.query.date;
    if (!DATE_RE.test(date || '')) return res.status(400).json({ error: 'Missing or invalid date' });
    const list = (await kv.get(`responses:${date}`)) || [];
    const top = req.query.top ? Number(req.query.top) : null;
    if (top) {
      const sorted = [...list].sort((a, b) => a.seconds - b.seconds).slice(0, top);
      return res.status(200).json({ responses: sorted });
    }
    return res.status(200).json({ responses: list });
  }

  if (req.method === 'POST') {
    const { date, entry } = req.body || {};
    if (!DATE_RE.test(date || '') || !entry || typeof entry.name !== 'string' || typeof entry.seconds !== 'number') {
      return res.status(400).json({ error: 'Invalid response payload' });
    }
    const name = entry.name.trim().slice(0, 60) || 'Anonymous';
    const seconds = Math.max(1, Math.min(36000, Math.round(entry.seconds)));
    const completedAt = typeof entry.completedAt === 'string' ? entry.completedAt : new Date().toISOString();

    const list = (await kv.get(`responses:${date}`)) || [];
    list.push({ name, seconds, completedAt });
    list.sort((a, b) => a.seconds - b.seconds);
    await kv.set(`responses:${date}`, list.slice(0, MAX_STORED));
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST');
  res.status(405).json({ error: 'Method not allowed' });
};
