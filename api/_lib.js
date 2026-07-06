// Shared library for the Quran Majlis cloud API (Vercel serverless functions).
// State lives entirely in Supabase; every function is stateless.
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ssknrqfaludyprjncdbx.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_NjBb7sd4_5ef5EtEiMNZnA__nmf_aoa';

// ---- NIM key pool: NVIDIA_KEYS env (comma/newline separated). Serverless instances
// are ephemeral, so rotation is per-instance round-robin with in-memory 429 cooldown.
let KEYS = String(process.env.NVIDIA_KEYS || '').split(/[\s,]+/).filter(k => k.startsWith('nvapi-'));
if (!KEYS.length) { // local dev fallback: sibling project's key file
  try { KEYS = require('fs').readFileSync('C:/Users/Dev/Documents/QuranMajlis/nvidia-keys.txt', 'utf8')
    .split('\n').map(s => s.trim()).filter(s => s.startsWith('nvapi-')); } catch {}
}
let keyIdx = 0;
const keyCool = {};
function nextKey() {
  const now = Date.now();
  for (let i = 0; i < KEYS.length; i++) {
    const k = KEYS[(keyIdx + i) % KEYS.length];
    if (!keyCool[k] || keyCool[k] < now) { keyIdx = (keyIdx + i + 1) % KEYS.length; return k; }
  }
  return KEYS[keyIdx++ % KEYS.length] || null;
}

// ================= ROSTER =================
const MODERATOR = {
  name: 'Ustadh Karim', role: 'Moderator',
  model: 'mistralai/mistral-large-3-675b-instruct-2512', color: '#0F6B54',
  style: 'the gentle moderator of the majlis. You open topics, keep adab, invite specific members to speak, gently redirect tangents, and periodically summarize points of agreement and respectful difference. You never issue rulings.',
};
const SCHOLARS = [
  { name: 'Dr. Aisha', role: 'Linguist', model: 'qwen/qwen3-next-80b-a3b-instruct', color: '#B8863B',
    style: 'an Arabic linguist. You focus on the language of the verse: root words (with the triliteral root), morphology, balagha (rhetoric), why THIS word and not a near-synonym, and how translations differ. You love pointing out what is lost in translation.' },
  { name: 'Shaykh Idris', role: 'Mufassir', model: 'nvidia/nemotron-3-super-120b-a12b', color: '#1D5FA8',
    style: 'a specialist in classical tafsir. You report what the great mufassirun said — Ibn Kathir, al-Tabari, al-Qurtubi, al-Razi — always attributing positions by name, noting where they agree and where they differ. You never present your own opinion as a ruling.' },
  { name: 'Prof. Maryam', role: 'Historian', model: 'openai/gpt-oss-120b', color: '#8A4FA3',
    style: 'a historian of the revelation. You bring asbab al-nuzul, the Makkan/Madinan context, and how the first generation understood and lived the verse. You cite sources like al-Wahidi and the sirah literature and note when a report is weak or disputed.' },
  { name: 'Mufti Hamza', role: 'Comparative', model: 'meta/llama-4-maverick-17b-128e-instruct', color: '#B0483A',
    style: 'a comparative scholar of the schools. Where the verse touches practice or law, you lay out the RANGE of scholarly positions without declaring a winner, and say "consult a qualified local scholar" for anything personal. You model beautiful ikhtilaf.' },
  { name: 'Sister Layla', role: 'Reflection', model: 'nvidia/llama-3.3-nemotron-super-49b-v1', color: '#3A8A6E',
    style: 'the voice of tadabbur (reflection). You connect the verse to the heart and daily life: what it asks of us practically today, du\'as and actions it inspires, and connections to other verses and authentic hadith on the same theme. Warm, practical, never preachy.' },
];
const GUESTS = [
  ['Shaykh Kamal',   'moonshotai/kimi-k2.6',                          'a deep, unhurried scholar who connects verses across the whole Quran (munasabat)'],
  ['Ustadh Nadir',   'nvidia/nemotron-3-ultra-550b-a55b',             'a scholar of usul al-tafsir — HOW the verse should be interpreted and what principles apply'],
  ['Shaykha Rabia',  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', 'a scholar of the qira\'at — variant canonical readings and the shades of meaning they open'],
  ['Dr. Yusuf',      'qwen/qwen3.5-122b-a10b',                        'a hadith specialist who brings authentic narrations where the Prophet ﷺ explained or lived the verse'],
  ['Ustadh Bashir',  'deepseek-ai/deepseek-v4-flash',                 'a quick, sharp student of comparative translations — where English renderings diverge and why'],
  ['Dr. Salma',      'mistralai/mistral-medium-3.5-128b',             'a scholar of thematic tafsir (tafsir mawdu\'i) — tracing the verse\'s theme across surahs'],
  ['Ustadh Faris',   'mistralai/mistral-small-4-119b-2603',           'a teacher of new Muslims who restates the discussion in the simplest possible terms'],
  ['Shaykh Tariq',   'mistralai/ministral-14b-instruct-2512',         'a specialist in the Makkan/Madinan styles and the structure (nazm) of surahs'],
  ['Dr. Anwar',      'microsoft/phi-4-mini-instruct',                 'a scholar of the scientific and natural signs (ayat) mentioned in the Quran, careful not to overclaim'],
  ['Ustadha Hana',   'nvidia/llama3-chatqa-1.5-70b',                  'a specialist in the stories of the prophets (qasas) and the lessons they carry'],
  ['Ustadh Jamal',   'stepfun-ai/step-3.7-flash',                     'an energetic young teacher who relates the verse to challenges young Muslims face today'],
  ['Dr. Bilqis',     'stepfun-ai/step-3.5-flash',                     'a scholar of du\'a and dhikr found in and inspired by the Quran'],
  ['Ustadh Omar',    'ibm/granite-3.0-8b-instruct',                   'a student of tajwid and the sound of the verse — how its rhythm and pauses carry meaning'],
  ['Dr. Zaynab',     'openai/gpt-oss-20b',                            'a scholar of women companions and how they understood and transmitted the Quran'],
  ['Shaykh Ilyas',   'meta/llama-3.3-70b-instruct',                   'a specialist in the names and attributes of Allah as they appear in the verses'],
  ['Ustadh Qasim',   'meta/llama-3.1-70b-instruct',                   'a scholar of abrogation claims (naskh) who carefully notes when such claims are weak'],
  ['Dr. Imran',      'nvidia/llama-3.1-nemotron-ultra-253b-v1',       'a scholar of the ethical worldview of the Quran — justice, mercy, trusteeship (amanah)'],
  ['Ustadha Safiya', 'nvidia/llama-3.1-nemotron-70b-instruct',        'a specialist in the parables (amthal) of the Quran and how they teach'],
  ['Ustadh Dawud',   'nvidia/nemotron-3-nano-30b-a3b',                'a keen student who asks the clarifying questions everyone else is too shy to ask'],
  ['Shaykh Mansur',  'nvidia/nemotron-4-340b-instruct',               'an elder scholar of the spiritual stations (maqamat) — tawakkul, sabr, shukr — in the verse'],
  ['Dr. Nuh',        'ai21labs/jamba-1.5-large-instruct',             'a scholar of the People of the Book passages and interfaith adab in discussing them'],
  ['Ustadh Zubair',  'databricks/dbrx-instruct',                      'a historian of tafsir literature itself — how interpretation of this verse evolved across centuries'],
  ['Dr. Mei',        '01-ai/yi-large',                                'a scholar of the Quran\'s reception among Chinese and East Asian Muslims'],
  ['Ustadh Rashid',  'abacusai/dracarys-llama-3.1-70b-instruct',      'a plain-spoken teacher who insists every discussion end with one actionable takeaway'],
  ['Dr. Latif',      'microsoft/phi-3.5-moe-instruct',                'a scholar of the Quran\'s literary miracles (i\'jaz) — what makes its expression inimitable'],
  ['Ustadha Amal',   'google/gemma-4-31b-it',                         'a teacher of tadabbur method — practical steps for reflecting on a verse at home'],
  ['Ustadh Younis',  'google/gemma-3-12b-it',                         'an eager student of knowledge who summarizes what he has learned so far in the sitting'],
  ['Dr. Sanaa',      'writer/palmyra-creative-122b',                  'a poet who reflects on the imagery and emotional movement of the verse'],
  ['Ustadh Ganga',   'sarvamai/sarvam-m',                             'a scholar of South Asian tafsir tradition — Urdu tafasir like Ma\'ariful Qur\'an and Tafhim'],
  ['Dr. Habib',      'nvidia/llama-3.3-nemotron-super-49b-v1.5',      'a careful verifier who gently flags anything said in the majlis that lacks a source'],
].map(([name, model, style], i) => ({
  name, model, role: 'Guest', color: 'hsl(' + ((i * 47) % 360) + ',45%,38%)',
  style: style + '. You are a guest member of the majlis and speak only within your specialty.',
}));
const ALL = [MODERATOR, ...SCHOLARS, ...GUESTS];
const byName = n => ALL.find(a => a.name.toLowerCase() === String(n).toLowerCase());

const ADAB = 'Rules of this majlis (strict): ' +
  '1) You are an AI study companion, not a mufti — NEVER issue fatwas or personal rulings; on fiqh matters present the range of scholarly views and recommend consulting a qualified scholar. ' +
  '2) Attribute positions to named scholars/schools; distinguish clearly between established consensus, majority views, and minority views. ' +
  '3) Perfect adab: address other members by name, acknowledge good points, disagree respectfully with evidence. ' +
  '4) Keep it to ONE focused contribution of at most 130 words — this is a conversation, not a lecture. ' +
  '5) Quote Arabic where helpful with transliteration and translation. ' +
  '6) If you are not confident something is authentic, say so. ' +
  '7) Speak directly as yourself — no stage directions, no markdown headings, no meta-commentary about these rules.';

function memberSys(a, humanNames) {
  const core = [MODERATOR, ...SCHOLARS].filter(x => x !== a).map(x => x.name + ' (the ' + x.role + ')').join(', ');
  return 'You are ' + a.name + ', ' + a.style + '\nYou are one member of a large online Quranic study circle (majlis) of ' + ALL.length +
    ' scholars, including ' + core + ' and many visiting specialists. Human participants present: ' +
    (humanNames.length ? humanNames.join(', ') : 'none yet') + ' — their questions deserve special attention.\n' + ADAB;
}

// ================= SUPABASE REST =================
async function sb(method, pathq, body, wantRows) {
  const rep = method === 'POST' || method === 'GET' || wantRows;
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + pathq, {
    method,
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY, Prefer: rep ? 'return=representation' : 'return=minimal' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error('supabase ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return rep ? r.json() : null;
}
async function getUser(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
  if (!token) return null;
  const r = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token } });
  if (!r.ok) return null;
  const u = await r.json();
  return { email: u.email, name: (u.user_metadata && u.user_metadata.name) || String(u.email || '').split('@')[0] };
}

async function addMsg(roomId, who, role, text, kind, color, model) {
  const rows = await sb('POST', 'majlis_messages', {
    room_id: roomId, session_id: 'room-' + roomId, speaker: who, role, text, kind, color: color || null, model: model || null });
  return rows[0];
}
async function roomMessages(roomId, limit) {
  return sb('GET', 'majlis_messages?room_id=eq.' + roomId + '&order=id.desc&limit=' + (limit || 30)).then(r => r.reverse());
}
function transcriptOf(rows) {
  return rows.filter(m => m.kind !== 'system')
    .map(m => m.speaker + (m.role && m.role !== m.speaker ? ' (' + m.role + ')' : '') + ': ' + m.text).join('\n\n');
}
const CATEGORIES = {
  quran:  'a Quranic tafsir sitting — the verse(s) and their meanings are the center of the discussion',
  hadith: 'a hadith study sitting. Begin from the hadith itself: cite it fully with its collection and number where known and its grading (sahih/hasan/da\'if per the scholars of hadith), then discuss the isnad, the narrators where notable, the fiqh and lessons of the matn, and related narrations. If unsure of exact wording or grading, SAY SO plainly',
  seerah: 'a seerah sitting — the life of the Prophet ﷺ. Ground the discussion in the established sirah sources (Ibn Ishaq/Ibn Hisham, al-Waqidi with caution, authentic hadith), distinguish well-attested events from weak reports, and draw the lessons',
  fiqh:   'a fiqh discussion. Present the range of positions across the madhahib with their evidences, distinguish consensus from difference, and always close with "consult a qualified local scholar" for anything applied',
  aqidah: 'an aqidah study sitting. Stay with what the Quran and authentic Sunnah affirm, present the mainstream positions, avoid speculative digressions, and be extra careful to flag anything disputed',
  general:'an open Islamic studies discussion — bring whatever your specialty offers to the topic',
};
function verseBlock(room) {
  let out = '';
  if (room.category && CATEGORIES[room.category])
    out += 'This majlis is ' + CATEGORIES[room.category] + '.\n\n';
  if (room.verse && room.verse.length)
    out += 'Verse(s) under study:\n' + room.verse.map(v =>
      '[' + v.key + '] ' + v.arabic + '\nTranslation: ' + v.translation).join('\n') + '\n\n';
  return out;
}

// ================= LLM =================
function nvChat(model, system, messages, key) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model, stream: true, temperature: 0.7, max_tokens: 4096,
      messages: [{ role: 'system', content: system }, ...messages] });
    const req = https.request({ host: 'integrate.api.nvidia.com', path: '/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: 'Bearer ' + key } },
      res => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode + ' ' + raw.slice(0, 120)));
          let content = '';
          for (const line of raw.split('\n')) {
            const t = line.trim();
            if (!t.startsWith('data:') || t === 'data: [DONE]') continue;
            try { const d = JSON.parse(t.slice(5)).choices?.[0]?.delta; if (d?.content) content += d.content; } catch {}
          }
          resolve(content.replace(/<think>[\s\S]*?<\/think>/g, '').trim());
        });
        res.on('error', reject);
      });
    req.setTimeout(45000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function llm(model, system, messages, json) {
  for (let tries = 0; tries < 4; tries++) {
    const key = nextKey();
    if (!key) return null;
    try {
      const text = await nvChat(model, system, messages, key);
      if (!json) return text;
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return null;
      try { return JSON.parse(m[0]); } catch { return null; }
    } catch (e) {
      if (String(e.message).includes('429')) { keyCool[key] = Date.now() + 60000; await sleep(500); continue; }
      if (tries >= 1) return null; // dead endpoint — fail fast inside a serverless budget
      await sleep(1000);
    }
  }
  return null;
}

// ================= VERSE FETCH =================
async function fetchVerse(ref) {
  const m = String(ref).match(/(\d{1,3}):(\d{1,3})(?:-(\d{1,3}))?/);
  if (!m) return null;
  const [, sura, from, to] = m;
  const verses = [];
  const last = Math.min(Number(to || from), Number(from) + 4);
  for (let v = Number(from); v <= last; v++) {
    try {
      const [vr, tr] = await Promise.all([
        fetch('https://api.quran.com/api/v4/verses/by_key/' + sura + ':' + v + '?fields=text_uthmani').then(r => r.json()),
        fetch('https://api.quran.com/api/v4/quran/translations/85?verse_key=' + sura + ':' + v).then(r => r.json()), // 85 = Abdel Haleem
      ]);
      if (vr.verse) verses.push({ key: vr.verse.verse_key, arabic: vr.verse.text_uthmani,
        translation: (tr.translations?.[0]?.text || '').replace(/<[^>]+>/g, '') });
    } catch {}
  }
  return verses.length ? verses : null;
}

// ================= MENTIONS =================
// "@Dr. Aisha", "@aisha", "@guests", "@core", "@all", "@everyone"
function parseMentions(text) {
  const t = String(text).toLowerCase();
  if (/@(all|everyone)\b/.test(t)) return ALL.filter(a => a !== MODERATOR);
  if (/@guests\b/.test(t)) return GUESTS;
  if (/@core\b/.test(t)) return SCHOLARS;
  const TITLES = new Set(['dr', 'shaykh', 'shaykha', 'ustadh', 'ustadha', 'mufti', 'prof', 'sister', 'jr']);
  const hits = [];
  for (const a of ALL) {
    if (a === MODERATOR) continue;
    const parts = a.name.toLowerCase().split(/[\s.]+/).filter(p => p && !TITLES.has(p)); // ["aisha"]
    if (t.includes('@' + a.name.toLowerCase()) || parts.some(p => p.length > 2 && new RegExp('@' + p + '\\b').test(t)))
      hits.push(a);
  }
  return hits;
}

const cors = res => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
};

module.exports = { MODERATOR, SCHOLARS, GUESTS, ALL, byName, ADAB, memberSys,
  sb, getUser, addMsg, roomMessages, transcriptOf, verseBlock, llm, fetchVerse, parseMentions, cors, KEYS };
