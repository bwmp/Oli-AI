# Oli AI Discord Chatbot

Discord conversation bot powered by a local Ollama model, tuned for multi-user channels on limited-memory hardware.

## What Changed

- Added machine-parsable multi-user history blocks:
  - `[Channel: #name | id=...]`
  - `[User: DisplayName | id=DiscordUserId]`
  - `[Assistant]`
- Added strict identity rules in the system prompt:
  - user ids are authoritative
  - no cross-user preference attribution
  - ask one brief clarification if speaker attribution is ambiguous
- Added rolling channel summary that is updated when history is compressed and on periodic/topic-shift triggers.
- Added per-user memory cards (likes/dislikes/preferences/running context) keyed by Discord user id.
- Added context budgeting that prioritizes:
  1. system/rules
  2. memory blocks
  3. recent history (`AI_HISTORY_LAST_K`)
- Added Ollama runtime options for `num_ctx`, `temperature`, and `top_p`.

## Recommended Defaults (16GB Mac mini)

Use these in `.env`:

```env
OLLAMA_MODEL=mistral-nemo
OLLAMA_NUM_CTX=8192
OLLAMA_TEMPERATURE=0.7
OLLAMA_TOP_P=0.9
AI_HISTORY_LAST_K=18
AI_SUMMARY_EVERY_N_MESSAGES=12
AI_CONTEXT_UTILIZATION=0.82
```

- `8192` is the safe default for 16GB.
- `16384` is opt-in if your model quantization and workload remain stable.

## Config Knobs

- `OLLAMA_HOST`: Ollama base URL.
- `OLLAMA_MODEL`: model name (default: `mistral-nemo`).
- `OLLAMA_TIMEOUT`: request timeout in ms.
- `OLLAMA_NUM_CTX`: context window target sent to Ollama.
- `OLLAMA_TEMPERATURE`: generation temperature.
- `OLLAMA_TOP_P`: nucleus sampling.
- `AI_HISTORY_LAST_K`: number of newest messages preserved before summarization.
- `AI_SUMMARY_EVERY_N_MESSAGES`: periodic summary update frequency.
- `AI_CONTEXT_UTILIZATION`: fraction of `num_ctx` to target for prompt input tokens.
- `AI_BOT_WHITELIST_IDS`: bot user ids allowed as speakers.
- `AI_BOT_CHAT_MODE`: `reply_or_mention` (safe default), `always`, or `chime`.

## Bot-to-Bot Setup (same code, different model)

To make two bots talk to each other safely:

1. Put each bot's user id in the other's `AI_BOT_WHITELIST_IDS`.
2. Keep `AI_BOT_CHAT_MODE=reply_or_mention` to avoid infinite ping-pong loops.
3. Trigger with a mention or reply from one bot to the other.

Use `AI_BOT_CHAT_MODE=always` only if you intentionally want autonomous back-and-forth and understand it can loop.

## Modelfile (Optional Discord Variant)

If you want a model variant with defaults baked in:

1. Edit `Modelfile.discord` if needed.
2. Create it:

```bash
ollama create mistral-nemo-discord -f Modelfile.discord
```

3. Set in `.env`:

```env
OLLAMA_MODEL=mistral-nemo-discord
```

## Verification

Run the memory/identity harness:

```bash
pnpm run test:harness
```

It verifies:
- multi-user id tagging format
- user A/B preference separation
- rolling summary retention under longer conversations
