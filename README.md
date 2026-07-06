# 🕌 Quran Majlis

An online Quranic study circle where **36 AI scholars — each a different open model on NVIDIA NIM — discuss a verse together, and humans sit in the circle with them.**

Every member has a distinct specialty (classical tafsir, Arabic morphology, asbab al-nuzul, comparative fiqh, qira'at, hadith, tadabbur…) and strict adab rules: no fatwas, positions attributed to named scholars and schools, respectful ikhtilaf, one focused contribution per turn.

## Features

- **Multi-user rooms** — sign in with email, convene a majlis on any verse or question, or join an ongoing one. Sessions persist forever (Supabase).
- **Verse auto-fetch** — a topic like `2:255` pins the Arabic (Uthmani) and translation at the top of the room.
- **@mentions** — `@Dr. Aisha`, `@guests`, `@core`, `@all` address specific members or groups; otherwise the AI moderator picks who speaks.
- **Full circle** — every member who hasn't spoken yet contributes once, then the moderator synthesizes.
- **36 different models** — Mistral Large, Nemotron Ultra, Kimi, GPT-OSS, Llama 4, Qwen, DeepSeek, Gemma, Granite, Yi, Jamba, DBRX, Sarvam and more, so the circle has genuinely different voices.

## Architecture

Vercel serverless + Supabase (auth, rooms, messages). The client drives discussion: `POST /api/say` returns a speaker queue, then one `POST /api/speak` per member (one model call per function invocation). NIM keys rotate from the `NVIDIA_KEYS` env var (comma-separated) with per-key 429 cooldown.

```
index.html        static client (login, lobby, room)
api/_lib.js       roster, adab rules, key pool, LLM + Supabase helpers
api/rooms.js      GET list / POST create (fetches verses, moderator opens)
api/say.js        human message → speaker queue (@mentions or moderator pick)
api/speak.js      one member speaks once
api/messages.js   room polling
dev.js            local shim emulating the Vercel runtime (port 3122)
setupdb.js        Supabase schema migration (needs SUPABASE_DB_PASSWORD env)
```

## Run locally

```
node dev.js
```
Put NIM keys in `NVIDIA_KEYS` (or the dev fallback key file) and open http://localhost:3122.

## Deploy

```
vercel --prod
vercel env add NVIDIA_KEYS production   # comma-separated nvapi- keys
```

---

*AI study companions, not muftis — for personal rulings, consult a qualified scholar.*
