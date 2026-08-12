// Antigravity image generation via v1internal gRPC.
// Reuses the same auth chain (ensureFreshToken + loadCodeAssist) and
// grpcGenerateContent transport as the chat path, with responseModalities=IMAGE
// injected into the GenerationConfig. Proto field numbers extracted from the
// Antigravity 2.7.1 language_server binary.

import {
  ensureFreshToken,
  loadCodeAssist,
  getClientCredentials,
  getStoredToken,
  saveSecrets,
  grpcGenerateContent,
  buildGenerateContentRequest,
} from "../../antigravity/index.mjs";

// Cached project (same memoization pattern as server.js _antigravityProject).
let _cachedProject = null;

const MODALITY_IMAGE = "IMAGE";

export const antigravityAdapter = {
  id: "antigravity",

  async generateImage(options, ctx) {
    const { prompt, imageB64List, imageMimeTypes } = options;
    const endpoint = ctx.endpoint;

    // 1. Resolve fresh access token (refresh if expired).
    const creds = getClientCredentials();
    const tokenInfo = await ensureFreshToken({
      store: { getStoredToken, saveSecrets },
      clientId: creds.client_id,
      clientSecret: creds.client_secret,
    });
    if (!tokenInfo?.access_token) {
      throw new Error("Antigravity auth not found. Complete Antigravity subscription login.");
    }

    // 2. Resolve cloudaicompanionProject (cached, same as chat path).
    const proxyUrl = ctx.proxyUrl || null;
    if (!_cachedProject) {
      const { project } = await loadCodeAssist({
        accessToken: tokenInfo.access_token,
        fetchImpl: ctx.fetchImpl,
      });
      _cachedProject = project;
    }

    // 3. Build the v1internal GenerateContent request body.
    const model = options.model || "gemini-3.1-flash-image";
    const input = [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: prompt }],
      },
    ];

    // Attach reference images if provided.
    if (imageB64List?.length) {
      for (const [index, b64] of imageB64List.slice(0, 3).entries()) {
        const mimeType = imageMimeTypes?.[index] || "image/jpeg";
        input[0].content.push({
          type: "input_image",
          image_url: `data:${mimeType};base64,${b64}`,
        });
      }
    }

    const body = buildGenerateContentRequest(
      { model, input },
      { project: _cachedProject, accountId: tokenInfo.account_id, model },
    );

    // 4. Inject responseModalities=IMAGE into the generationConfig.
    if (!body.request.generationConfig) body.request.generationConfig = {};
    body.request.generationConfig.responseModalities = [MODALITY_IMAGE];

    // 5. Send via gRPC and scan response for inline image data.
    const stream = grpcGenerateContent({
      accessToken: tokenInfo.access_token,
      body,
      proxyUrl,
    });

    let b64Json = null;
    let revisedPrompt = null;

    for await (const resp of stream) {
      const candidates = resp?.response?.candidates || [];
      for (const cand of candidates) {
        const parts = cand?.content?.parts || [];
        for (const part of parts) {
          if (part.inlineData?.data) {
            b64Json = part.inlineData.data;
          }
        }
      }
    }

    if (!b64Json) {
      throw new Error("Antigravity image response did not contain image data");
    }

    return { b64Json, revisedPrompt };
  },
};
