import type { AppConfig, Endpoint } from "../core/types";

export interface CopyTarget {
  client: string;
  protocol?: string;
}

export interface RevealedEndpointSecrets {
  single?: string;
  credentials?: Record<string, string>;
}

export interface CopyNodeState {
  targetClient: string;
  sourceClient: string;
  sourceEndpointId: string;
}

const CHAT_PROTOCOL_TYPES = new Set([
  "anthropic",
  "openai-chat",
  "openai-responses",
  "grok",
]);

export function inferCopiedEndpointType(
  targetClient: string,
  targetProtocol: string | undefined,
  sourceEndpoint: Endpoint,
): string {
  if (!CHAT_PROTOCOL_TYPES.has(sourceEndpoint.type)) return sourceEndpoint.type;
  if (targetClient === "codex" || targetClient === "deeptutor") {
    return "openai-responses";
  }
  if (targetClient === "code" || targetClient === "desktop") {
    return "anthropic";
  }
  return targetProtocol === "openai" ? "openai-responses" : "anthropic";
}

export function buildEndpointCopyDraft(
  sourceEndpoint: Endpoint,
  target: CopyTarget,
  revealedSecrets: RevealedEndpointSecrets,
  idFactory: () => string = () => `ep_${crypto.randomUUID()}`,
  credentialIdFactory: () => string = () => `cred_${crypto.randomUUID()}`,
): Endpoint {
  const draft = structuredClone(sourceEndpoint);
  draft.id = idFactory();
  draft.type = inferCopiedEndpointType(
    target.client,
    target.protocol,
    sourceEndpoint,
  );
  draft.is_default = false;
  delete draft.api_key;
  delete draft.api_key_env;
  delete draft.has_api_key;
  delete draft.api_key_values;

  if (sourceEndpoint.api_keys?.length) {
    draft.api_keys = [];
    draft.api_key_values = {};
    for (const sourceCredential of sourceEndpoint.api_keys) {
      const credentialId = credentialIdFactory();
      draft.api_keys.push({ id: credentialId });
      const apiKey = revealedSecrets.credentials?.[sourceCredential.id];
      if (apiKey) draft.api_key_values[credentialId] = apiKey;
    }
  } else if (revealedSecrets.single) {
    draft.api_key = revealedSecrets.single;
  }

  return draft;
}

export function listCopySources(config: AppConfig, targetClient: string) {
  return Object.entries(config.clients || {})
    .filter(([client]) => client !== targetClient)
    .map(([client, value]) => ({
      client,
      endpoints: value.endpoints || [],
    }));
}
