const { clearAdminCookie } = require('./_lib/util');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  clearAdminCookie(res);
  res.status(200).json({ ok: true });
};
