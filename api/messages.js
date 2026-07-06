// GET /api/messages?room_id=N&since=ID — poll a room's messages.
const L = require('./_lib');

module.exports = async (req, res) => {
  L.cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const q = req.query || {};
    const roomId = Number(q.room_id), since = Number(q.since || 0);
    if (!roomId) return res.status(400).json({ error: 'room_id required' });
    const rows = await L.sb('GET', 'majlis_messages?room_id=eq.' + roomId + '&id=gt.' + since + '&deleted=eq.false&order=id.asc&limit=200&select=id,speaker,role,text,kind,color,at');
    res.status(200).json({ messages: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
