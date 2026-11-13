# Yehonatan's fork — what changed

Branch `yehonatan/custom` on top of upstream v0.6.1.

## Voice (ElevenLabs)
- **Dictation**: ElevenLabs Scribe v2 realtime (`scribe_v2_realtime`, VAD commits) is used whenever
  `ELEVENLABS_API_KEY` is set; Deepgram remains the fallback. `/api/stt/token` mints a single-use
  token, so the key never reaches the browser. Language comes from Settings → Keys → Dictation.
- **Read-aloud**: a 🔊 button under every teacher message (`components/speak-button.tsx`) →
  `POST /api/tts` → ElevenLabs TTS. Defaults: voice Viktor M (`8sZ9Z3Jy28CGLLCmKEHn`), model
  `eleven_v4` with a fallback to `eleven_multilingual_v2`. Override with `ELEVENLABS_VOICE_ID` /
  `ELEVENLABS_TTS_MODEL`. Code, formulas and diagrams are replaced by short spoken cues
  (`src/core/speech-text.ts`).

## Knowledge decay (FSRS-5)
- `src/core/memory.ts`: a pure FSRS-5 model. Each proposition's recall probability is **derived**
  from three sources: teaching exposures (node provenance), practice outcomes (`problem` →
  `conclude` with outcome + hint rung), and explicit recall checks (`graph/memory-reviews.jsonl`).
  No migration: deleting the explicit log only drops explicit recalls.
- Graph: nodes fade by retention; the node card shows a retention bar (`snapshot.retention`).
- `GET /api/memory[?faded=1]` returns per-node state and the review queue.
- Sidebar **Review (N)** opens a practice draft seeded with the most-faded propositions.
- Agents: the prober and practice agents get `faded_propositions` + `record_recall`. The prober
  doctrine requires re-checking faded prerequisites before the plan builds on them.

## Running as the central server
- `C:\Users\User\learnharness-data\start-server.cmd` (`next start` on 127.0.0.1:3077, data in
  `learnharness-data`), launched at logon by a Startup-folder `.vbs`.
- `tailscale serve --bg --https=8443 http://127.0.0.1:3077` →
  https://maindesktop.tail51df21.ts.net:8443 (tailnet only; HTTPS is required for the mic).
- After a code change: `npm run build`, then restart the server process.

## Dictation cleanup (Haiku)
- After Stop, the transcript goes through `POST /api/stt/cleanup` before landing in the field:
  misheard words (domain-aware: genomics), fillers, punctuation, clear phrasing — never answering.
  The pending question (`[data-dictation-context]`) is passed as context.
- Claude Code: a direct one-shot `claude -p --model haiku` with `MAX_THINKING_TOKENS=0` (~3–4s; the
  default thinking took ~45s). Otherwise the cheap slot. Any failure/timeout (25s) → raw text.
- Per-device switch: Settings → Keys → Dictation → "Clean up transcript" (default on).
