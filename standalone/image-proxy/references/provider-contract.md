# OpenAI-compatible image provider contract

The standalone runtime targets an OpenAI-compatible image surface:

- text-only generation: `POST {base_url}/images/generations` with JSON containing `model`, `prompt`, `n`, `size`, `quality`, and `response_format: "url"`;
- image edit: `POST {base_url}/images/edits` as multipart form data containing `model`, `prompt`, `size`, `quality`, `n`, one or more `image` parts, and an optional PNG `mask` part.

The runtime sends `Authorization: Bearer <key>`, `Accept: */*`, and a conservative curl user agent. It accepts response items containing either:

- `url`, which is downloaded with curl; or
- `b64_json`, which is decoded locally; or
- a `data:image/...;base64,...` URL, which is decoded locally.

Each returned item must be decodable as PNG, JPEG, or WebP before it is recorded as an output asset. A single output is named `image.png`; multiple outputs are named `image-01.png`, `image-02.png`, and so on. The provider response is retained as `response.json`, while `request.json` contains only the redacted request snapshot and never the API key.

The default ThinkAI profile is a convenience preset for this independent skill:

```json
{
  "name": "ThinkAI",
  "base_url": "https://www.thinkai.tv/v1",
  "model": "gpt-image-2",
  "api_key_env": "THINKAI_IMAGE_API_KEY"
}
```

An alternative OpenAI-compatible provider must be explicitly supplied through the config or command-line overrides. The runtime does not infer a compatible model, translate provider-specific parameters, or switch to another endpoint after an error.
