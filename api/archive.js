const { kv } = require('@vercel/kv');

/** Lightweight metadata for the admin panel's archive list, newest first. */
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const dates = await kv.zrange('archive:index', 0, -1, { rev: true });
  const list = [];
  for (const date of dates) {
    const puzzle = await kv.get(`puzzle:${date}`);
    if (!puzzle) continue;
    const responses = (await kv.get(`responses:${date}`)) || [];
    list.push({
      date,
      title: puzzle.title || 'Untitled',
      acrossCount: puzzle.acrossClues?.length || 0,
      downCount: puzzle.downClues?.length || 0,
      responseCount: responses.length,
    });
  }
  res.status(200).json({ archive: list });
};
