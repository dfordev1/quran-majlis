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

    // Autonomous drive: any open browser heartbeats this endpoint with mode:'auto'.
    // An atomic claim on busy_until makes exactly ONE viewer drive each round.
    if (mode === 'auto' && !text) {
      if (!await L.claimRoom(room.id, 75000)) return res.status(200).json({ queue: [] }); // another viewer is driving
      // adab rest: after ~30 scholar turns with no human word, the circle pauses
      const recent = await L.sb('GET', 'majlis_messages?room_id=eq.' + room.id + '&order=id.desc&limit=31&select=kind,speaker');
      const humanIdx = recent.findIndex(m => m.kind === 'human');
      if (humanIdx === -1 && recent.filter(m => m.kind === 'scholar').length >= 30) {
        if (recent[0] && recent[0].speaker !== 'SYSTEM')
          await L.addMsg(room.id, 'SYSTEM', 'system', '🌙 The circle rests, awaiting your voice — say anything to resume.', 'system');
        return res.status(200).json({ queue: [], resting: true });
      }
    } else if (text) {
      // hisbah gate: duplicate-spam check, then Llama-Guard safety screen
      const [last] = await L.sb('GET', 'majlis_messages?room_id=eq.' + room.id + '&kind=eq.human&deleted=eq.false&speaker=eq.' + encodeURIComponent(user.name) + '&order=id.desc&limit=1&select=text,at');
      if (last && last.text === text && Date.now() - new Date(last.at).getTime() < 120000)
        return res.status(400).json({ error: 'You just said exactly that — the circle heard you the first time.' });
      if (await L.guardBlocks(text))
        return res.status(400).json({ error: 'That message does not meet the adab of this majlis and was not posted.' });
      await L.touchRoom(room.id, 75000).catch(() => {});
      await L.addMsg(room.id, user.name, 'human', text, 'human');
    }

    // Running summary: every ~15 scholar messages, the moderator condenses the sitting
    // so far into room.summary — every later speaker sees the WHOLE sitting cheaply.
    try {
      const newRows = await L.sb('GET', 'majlis_messages?room_id=eq.' + room.id + '&id=gt.' + (room.summary_upto || 0) + '&kind=eq.scholar&deleted=eq.false&order=id.asc&limit=40&select=id,speaker,role,text');
      if (newRows.length >= 15) {
        const upd = await L.llm(L.MODERATOR.model,
          'You maintain the running minutes of a Quranic study circle. Merge the existing summary with the new contributions into ONE updated summary (max 250 words): key points made and by whom, agreements, respectful differences, open questions. Plain prose, no headings.',
          [{ role: 'user', content: 'Existing summary:\n' + (room.summary || '(none yet)') + '\n\nNew contributions:\n' + L.transcriptOf(newRows) }]);
        if (upd) { await L.saveSummary(room.id, upd, newRows[newRows.length - 1].id); room.summary = upd; }
      }
    } catch {}

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
