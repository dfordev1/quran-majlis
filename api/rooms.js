// GET /api/rooms — list open rooms.  POST /api/rooms {topic} — create one (auth required).
const L = require('./_lib');

module.exports = async (req, res) => {
  L.cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    if (req.method === 'GET') {
      // "active" = a message landed in the last 10 minutes — a single indexed query,
      // not N+1: one lateral join per room, same cost as the old plain select.
      const rows = await L.db().query(
        `select r.id, r.at, r.topic, r.created_by, r.open, r.category,
                (m.last_at is not null and m.last_at > now() - interval '10 minutes') as active
         from majlis_rooms r
         left join lateral (select max(at) as last_at from majlis_messages where room_id = r.id) m on true
         order by r.id desc limit 50`);
      const rooms = rows.rows.map(r => ({ ...r, id: Number(r.id) }));
      // members rarely change — the client caches them, so skip resending unless asked (meta=1)
      const members = req.query.meta === '0' ? undefined : L.ALL.map(a => ({ name: a.name, role: a.role, model: a.model.split('/')[1], color: a.color }));
      return res.status(200).json({ rooms, members });
    }
    if (req.method === 'POST') {
      const user = await L.getUser(req);
      if (!user) return res.status(401).json({ error: 'sign in first' });
      const topic = String((req.body || {}).topic || '').slice(0, 300).trim();
      if (!topic) return res.status(400).json({ error: 'topic required' });
      const category = ['quran', 'hadith', 'seerah', 'fiqh', 'aqidah', 'general'].includes((req.body || {}).category) ? req.body.category : 'quran';
      const refMatch = category === 'quran' && topic.match(/(\d{1,3}):(\d{1,3})(?:-(\d{1,3}))?/);
      const verse = refMatch ? await L.fetchVerse(refMatch[0]) : null;
      const room = await L.createRoom(topic, verse, user.name, category);
      await L.addMsg(room.id, 'SYSTEM', 'system', '🕌 ' + user.name + ' convenes the majlis: "' + topic + '"', 'system');
      if (verse) for (const v of verse)
        await L.addMsg(room.id, 'QURAN', 'verse', v.arabic + '\n\n[' + v.key + '] ' + v.translation, 'verse');
      const opening = await L.llm(L.MODERATOR.model, L.memberSys(L.MODERATOR, [user.name]),
        [{ role: 'user', content: L.verseBlock(room) + 'Topic of this majlis: ' + topic +
          '\n\nOpen this majlis: welcome the circle warmly (briefly!), introduce the topic, and invite perspectives. Under 80 words.' }]);
      if (opening) await L.addMsg(room.id, L.MODERATOR.name, 'Moderator', opening, 'scholar', L.MODERATOR.color, L.MODERATOR.model);
      return res.status(200).json({ room });
    }
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
