// POST /api/say {room_id, text?} — post a human message (or just continue) and get the
// speaker queue for this round. @mentions pick speakers directly; otherwise the moderator
// chooses. The client then calls /api/speak once per queued name (that's what fits
// serverless time limits — one model call per invocation).
const L = require('./_lib');

module.exports = async (req, res) => {
  L.cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const user = await L.getUser(req);
    if (!user) return res.status(401).json({ error: 'sign in first' });
    const { room_id } = req.body || {};
    const text = String((req.body || {}).text || '').slice(0, 1000).trim();
    const mode = String((req.body || {}).mode || '');
    const [room] = await L.sb('GET', 'majlis_rooms?id=eq.' + Number(room_id));
    if (!room) return res.status(404).json({ error: 'room not found' });

    if (text) await L.addMsg(room.id, user.name, 'human', text, 'human');

    // Full circle: everyone who hasn't spoken in this room yet
    if (mode === 'roundtable') {
      const rows = await L.sb('GET', 'majlis_messages?room_id=eq.' + room.id + '&kind=eq.scholar&select=speaker&limit=1000');
      const spoken = new Set(rows.map(r => r.speaker));
      const queue = L.ALL.filter(a => a !== L.MODERATOR && !spoken.has(a.name)).map(a => a.name);
      queue.push(L.MODERATOR.name); // closing synthesis
      return res.status(200).json({ queue });
    }

    // @mentions win; otherwise moderator picks
    const mentioned = text ? L.parseMentions(text) : [];
    if (mentioned.length) return res.status(200).json({ queue: mentioned.slice(0, 8).map(a => a.name) });

    const rows = await L.roomMessages(room.id, 24);
    const spoken = new Set(rows.filter(m => m.kind === 'scholar').map(m => m.speaker));
    const pick = await L.llm(L.MODERATOR.model,
      'You are ' + L.MODERATOR.name + ', ' + L.MODERATOR.style + '\nMembers available:\n' +
      L.ALL.filter(a => a !== L.MODERATOR).map(s => s.name + ' — ' + (s.role === 'Guest' ? s.style.split('.')[0].replace(/^an? /, '') : s.role) +
        (spoken.has(s.name) ? '' : ' [has not spoken yet]')).join('\n') + '\n' + L.ADAB +
      '\nReply with JSON only: {"speakers":["Name","Name"],"remark":"optional one-to-two sentence moderator remark, or empty string"}' +
      '\nPick the 2 or 3 members whose expertise best serves the discussion RIGHT NOW (vary who speaks — favor relevant members who have not spoken yet; if a human asked something, prioritize answering them).',
      [{ role: 'user', content: L.verseBlock(room) + 'Topic: ' + room.topic + '\n\nDiscussion so far:\n' +
        (L.transcriptOf(rows) || '(just opened)') + '\n\n' +
        (text ? user.name + ' has just spoken. Address their point.' : 'Continue the discussion — go deeper, or bring in an angle not yet covered.') }], true);
    if (pick && pick.remark && String(pick.remark).trim())
      await L.addMsg(room.id, L.MODERATOR.name, 'Moderator', String(pick.remark).trim(), 'scholar', L.MODERATOR.color, L.MODERATOR.model);
    const queue = (pick && Array.isArray(pick.speakers) ? pick.speakers : ['Dr. Aisha', 'Shaykh Idris'])
      .map(n => L.byName(n)).filter(a => a && a !== L.MODERATOR).slice(0, 3).map(a => a.name);
    res.status(200).json({ queue: queue.length ? queue : ['Dr. Aisha', 'Shaykh Idris'] });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
