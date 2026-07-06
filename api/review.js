// POST /api/review {room_id} — the Hisbah pass. All 15 bench models audit the
// unreviewed scholar messages in parallel; the chief (Al-Muhtasib) aggregates and,
// on consensus (2+ reviewers flag the same message), posts a public correction and
// logs every verdict to majlis_flags. An atomic claim ensures one review at a time.
const L = require('./_lib');

module.exports = async (req, res) => {
  L.cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const user = await L.getUser(req);
    if (!user) return res.status(401).json({ error: 'sign in first' });
    const roomId = Number((req.body || {}).room_id);
    const upto = await L.claimReview(roomId, 120000);
    if (upto === null) return res.status(200).json({ ok: true, skipped: 'review already running' });

    const rows = await L.sb('GET', 'majlis_messages?room_id=eq.' + roomId + '&id=gt.' + upto +
      '&kind=eq.scholar&deleted=eq.false&order=id.asc&limit=10&select=id,speaker,text');
    if (rows.length < 4) return res.status(200).json({ ok: true, skipped: 'not enough new messages' });

    const batch = rows.map(m => '[msg ' + m.id + '] ' + m.speaker + ': ' + m.text).join('\n\n');
    const rubric = 'You are reviewing messages from AI scholars in an Islamic study circle. Flag ONLY real problems:\n' +
      '- "citation": a Quran/hadith citation or attribution that is wrong or invented (you must know the correct one to flag this)\n' +
      '- "fatwa": issuing a personal religious ruling ("you must/should do X") instead of reporting scholarly positions\n' +
      '- "adab": actual disrespect, mockery, insults, or sectarian attack BY the speaker toward another member — NOT a moderator calmly addressing someone else\'s bad behavior, and NOT a message merely discussing or quoting distressing content\n' +
      '- "leak": the message itself reads as an AI planning its answer out loud (e.g. starts with "We need to respond as...", "Let\'s draft...", contains word-count checking) — NOT a normal in-character opening like greeting other members or transitioning topics\n' +
      '- "spam": near-exact repetition of an earlier message, or gibberish\n' +
      'STRICT RULES: (1) Quoting the message back is NOT a reason — you must explain what specifically is wrong in your own words. ' +
      '(2) Normal scholarly discourse, greetings, addressing people by name, and moderators redirecting the conversation are ALL FINE — do not flag them. ' +
      '(3) When in doubt, do NOT flag — false accusations against a scholar are worse than missing a real problem.\n' +
      'Reply with JSON only: {"flags":[{"id":<msg number>,"problem":"citation|fatwa|adab|leak|spam","reason":"specific explanation in your own words, not a quote"}]} — empty array if all is well.';

    // Hard per-reviewer deadline: a single hung/dead model must never blow the
    // whole pass past Vercel's function limit. llm()'s own retries can otherwise
    // run ~90s on a bad endpoint — race it against a 20s cap and drop it if slow.
    const withDeadline = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);
    const verdicts = (await Promise.all(L.REVIEWERS.map(r =>
      withDeadline(L.llm(r.model, rubric, [{ role: 'user', content: batch }], true), 20000)
        .then(v => ({ reviewer: r.name, flags: (v && Array.isArray(v.flags)) ? v.flags : null }))
        .catch(() => ({ reviewer: r.name, flags: null }))
    ))).filter(v => v.flags !== null);

    // tally consensus per message+problem. A "reason" that's just the message quoted
    // back (the exact failure mode a broken reviewer showed in testing) doesn't count —
    // it's not real reasoning, so it can't contribute toward consensus.
    const isQuoteNotReason = (reason, msgText) => {
      const r = reason.toLowerCase().replace(/^you wrote\s*/, '').replace(/^['"]|['"]$/g, '');
      return r.length > 20 && msgText.toLowerCase().includes(r.slice(0, Math.min(40, r.length)));
    };
    const tally = {};
    for (const v of verdicts)
      for (const f of v.flags) {
        const id = Number(f.id);
        const msg = rows.find(m => m.id === id);
        if (!msg) continue; // hallucinated msg id
        const reason = String(f.reason || '');
        await L.addFlag(roomId, id, msg.speaker, v.reviewer, String(f.problem), reason.slice(0, 300));
        if (isQuoteNotReason(reason, msg.text)) continue; // logged for audit, but not counted
        const k = id + ':' + f.problem;
        (tally[k] = tally[k] || { id, problem: f.problem, reasons: [], reviewers: [] });
        tally[k].reasons.push(reason); tally[k].reviewers.push(v.reviewer);
      }
    // require 3 independent, genuinely-reasoned reviewers before ever speaking publicly —
    // a public correction naming a scholar is a serious act and false positives are costly
    const consensus = Object.values(tally).filter(t => t.reviewers.length >= 3);

    if (consensus.length) {
      const note = await L.llm(L.CHIEF ? L.CHIEF.model : L.MUHTASIB.model,
        'You are Al-Muhtasib, the quality overseer of an Islamic study circle. The review panel found problems by consensus. ' +
        'Write ONE brief public notice (under 90 words) to the circle: state gently what was inaccurate or improper and the correction, addressing the erring member by name with adab. No preamble.',
        [{ role: 'user', content: 'Messages under review:\n' + batch + '\n\nConsensus findings:\n' +
          consensus.map(c => 'msg ' + c.id + ' (' + c.problem + '): ' + c.reasons[0]).join('\n') }]);
      if (note) await L.addMsg(roomId, L.MUHTASIB.name, L.MUHTASIB.role, note, 'mod', L.MUHTASIB.color, null);
    }
    await L.saveReviewed(roomId, rows[rows.length - 1].id);
    res.status(200).json({ ok: true, reviewed: rows.length, panel: verdicts.length, consensus: consensus.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
