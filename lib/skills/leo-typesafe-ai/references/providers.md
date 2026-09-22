# Providers and transport

The TypeSafe programming model is provider-neutral: send `model`, `state`, and a map of typed `questions`; consume `answers` and `usage`. Providers may add response fields such as request IDs, provider names, or cost.

## Minimal environment setup

Recommended for every provider:

```text
LEO_TYPESAFE_API_KEY=<the selected provider's API key>
```

That is the only environment variable the normal workflow requires. Choose a non-default provider with `--provider`; choose a custom endpoint with `--url`.

Compatibility fallbacks are supported so existing setups continue to work:

| Provider | Endpoint | Default model | Key lookup |
| --- | --- | --- | --- |
| OpenRouter | `https://openrouter.ai/api/v1/systemone` | `jev-latest` | `LEO_TYPESAFE_API_KEY`, then `OPENROUTER_API_KEY` |
| TypeSafe official | `https://api.typesafe.ai/v1/systemone` | `jev-latest` | `LEO_TYPESAFE_API_KEY`, then `TYPESAFE_API_KEY` |
| Custom compatible | supplied with `--url` | `jev-latest` | `LEO_TYPESAFE_API_KEY`, or the name supplied with `--api-key-env` |

Do not copy a key from one provider to another without the user's explicit intent.

## OpenRouter

OpenRouter's TypeSafe SDK-compatible endpoint is:

```text
POST https://openrouter.ai/api/v1/systemone
```

The SDK base URL is `https://openrouter.ai/api`; an SDK appends `/v1/systemone`. The HTTP script uses the full endpoint. `jev-latest` is accepted and mapped by OpenRouter to its current TypeSafe Jev alias.

```bash
node scripts/decide.mjs --provider openrouter --input request.json
```

Raw curl diagnostic:

```bash
curl https://openrouter.ai/api/v1/systemone \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @request.json
```

OpenRouter also exposes `/api/alpha/decisions`. Use it only when the user explicitly selects the alpha API; set it through `--url` because alpha contracts can change:

```bash
node scripts/decide.mjs --provider custom \
  --url https://openrouter.ai/api/alpha/decisions \
  --model '~typesafe/jev-latest' \
  --input request.json
```

## TypeSafe official

```text
POST https://api.typesafe.ai/v1/systemone
```

```bash
node scripts/decide.mjs --provider typesafe --input request.json
```

Raw curl diagnostic:

```bash
curl https://api.typesafe.ai/v1/systemone \
  -H "Authorization: Bearer $TYPESAFE_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @request.json
```

## Custom compatible provider

Use this mode only for an endpoint that implements the TypeSafe/System One request and answer shapes.

```bash
node scripts/decide.mjs --provider custom \
  --url https://third-party.example/v1/systemone \
  --input request.json
```

If the existing secret has another environment variable name:

```bash
node scripts/decide.mjs --provider custom \
  --url https://third-party.example/v1/systemone \
  --api-key-env THIRD_PARTY_API_KEY \
  --input request.json
```

`--api-key-env` accepts a variable name, never the secret value.

## Request file

The request file contains `state` and `questions`; `model` is optional because the script supplies the provider default.

```json
{
  "state": "Help! My payouts have been failing for 3 days.",
  "questions": {
    "is_urgent": {
      "type": "noul",
      "instructions": "Does this message convey urgency?",
      "criteria": {
        "true": "Explicitly time-sensitive",
        "false": "No urgency expressed"
      }
    },
    "department": {
      "type": "choice",
      "instructions": "Which team should handle this?",
      "criteria": {
        "billing": "Payments, invoicing, refunds",
        "technical": "Bugs, outages, integrations",
        "sales": "Pricing, upgrades, new accounts"
      }
    },
    "frustration": {
      "type": "score",
      "instructions": "How frustrated is the customer?",
      "criteria": ["Calm", "Frustrated", "Very angry"]
    }
  }
}
```

## Error behavior

- `400/422`: correct the request; do not retry unchanged input.
- `401/403`: verify provider and credential selection; do not retry blindly.
- `402`: add provider credits or select another authorized provider.
- `429/529/502/503/524`: the script performs one bounded retry with backoff.
- Timeout or malformed JSON: surface the failure; application code decides whether to fall back.

