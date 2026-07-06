// POST /api/admin {action:'delete_message'|'delete_room', id} — admin-only moderation.
// The admin check is enforced HERE, server-side, against a fresh token lookup —
// never trust a client-side "isAdmin" flag for a destructive action.
const L = require('./_lib');

module.exports = async (req, res) => {
  L.cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const user = await L.getUser(req);
    if (!user) return res.status(401).json({ error: 'sign in first' });
    if (!L.isAdmin(user)) return res.status(403).json({ error: 'admin only' });

    const { action, id } = req.body || {};
    const n = Number(id);
    if (!n) return res.status(400).json({ error: 'id required' });

    if (action === 'delete_message') {
      const ok = await L.deleteMessage(n);
      return res.status(200).json({ ok });
    }
    if (action === 'delete_room') {
      const ok = await L.deleteRoom(n);
      return res.status(200).json({ ok });
    }
    res.status(400).json({ error: 'unknown action' });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
