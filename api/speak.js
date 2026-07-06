// POST /api/speak {room_id, name} — one member gives one contribution (one model call).
const L = require('./_lib');

module.exports = async (req, res) => {
  L.cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const user = await L.getUser(req);
    if (!user) return res.status(401).json({ error: 'sign in first' });
    const { room_id, name } = req.body || {};
    const a = L.byName(name);
    if (!a) return res.status(400).json({ error: 'unknown member' });
    const [room] = await L.sb('GET', 'majlis_rooms?id=eq.' + Number(room_id));
    if (!room) return res.status(404).json({ error: 'room not found' });

    const rows = await L.roomMessages(room.id, 30);
    const humans = [...new Set(rows.filter(m => m.kind === 'human').map(m => m.speaker))];
    const instruction = a === L.MODERATOR
      ? 'As moderator, briefly weave the recent contributions together — key threads, respectful differences — and pose ONE question or a closing reflection. Under 120 words.'
      : 'It is now YOUR turn to speak. Respond to the latest points (especially anything the human participants said), from your own specialty. One contribution only, nothing already said.';
    const text = await L.llm(a.model, L.memberSys(a, humans),
      [{ role: 'user', content: L.verseBlock(room) + 'Topic of this majlis: ' + room.topic +
        '\n\nDiscussion so far:\n' + (L.transcriptOf(rows) || '(the majlis has just begun)') + '\n\n' + instruction }]);
    if (!text) return res.status(200).json({ ok: false, name: a.name }); // silent seat (dead endpoint / rate-limited)
    const msg = await L.addMsg(room.id, a.name, a.role, text, 'scholar', a.color, a.model);
    res.status(200).json({ ok: true, message: msg });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
