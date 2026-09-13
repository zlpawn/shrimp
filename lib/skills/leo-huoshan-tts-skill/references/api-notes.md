# Ark TTS API Notes

## Endpoint

- Default endpoint: `https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional`
- Method: `POST`
- Response mode: `HTTP chunked`, line-delimited JSON objects

## Required Headers

- `X-Api-Key: ark-...`
- `X-Api-Resource-Id: seed-tts-2.0`
- `Content-Type: application/json`

Optional but recommended:

- `Connection: keep-alive`
- `X-Control-Require-Usage-Tokens-Return: *`

## Request Body

```json
{
  "req_params": {
    "text": "你好，这是通过 HTTP 接口合成的语音。",
    "speaker": "zh_female_vv_uranus_bigtts",
    "audio_params": {
      "format": "mp3",
      "sample_rate": 24000
    }
  }
}
```

## Stream Behavior

- The response content type can be `text/plain; charset=utf-8`.
- Each line is a JSON object.
- Audio payload arrives in `data` as base64.
- A line with `code: 0` and non-empty `data` contains an audio chunk.
- A line with `code: 20000000` indicates stream completion.
- Non-zero codes other than `20000000` should be treated as API errors.

## Practical Defaults

- Voice: `zh_female_vv_uranus_bigtts`
- Format: `mp3`
- Sample rate: `24000`

## Troubleshooting

- `Invalid X-Api-Key`: The key is not valid for this endpoint or is not an Ark key.
- `No readable text!`: The endpoint accepted the request but rejected the text payload. Re-check the request shape, headers, and whether the endpoint matches the API family.
- Empty output file: The response stream may have contained only error lines or no `data` chunks.
