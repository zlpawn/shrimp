import crypto from "node:crypto";

export function createCredentialId() {
  return `cred_${crypto.randomUUID()}`;
}

export function credentialSecretKey(endpointId, credentialId) {
  return `${endpointId}::${credentialId}`;
}

export function parseCredentialSecretKey(value) {
  const match = /^(.+)::([^:]+)$/.exec(String(value || ""));
  return match
    ? { endpointId: match[1], credentialId: match[2] }
    : null;
}

export function resolveStoredSecret(value, env = process.env) {
  const stored = String(value || "");
  if (!stored) return "";
  return stored.startsWith("env:")
    ? String(env[stored.slice(4)] || "")
    : stored;
}

export function listEndpointCredentials(endpoint, secrets, env = process.env) {
  const metadata = Array.isArray(endpoint?.api_keys) ? endpoint.api_keys : [];
  const values = secrets?.api_keys || {};
  return metadata.flatMap((credential, index) => {
    const scoped = values[credentialSecretKey(endpoint.id, credential.id)];
    const stored = scoped || (index === 0 ? values[endpoint.id] : "");
    const apiKey = resolveStoredSecret(stored, env);
    return apiKey ? [{ credentialId: credential.id, apiKey }] : [];
  });
}

export function hasStoredEndpointCredential(endpoint, secrets) {
  const values = secrets?.api_keys || {};
  return (endpoint?.api_keys || []).some((credential, index) =>
    Boolean(
      values[credentialSecretKey(endpoint.id, credential.id)]
      || (index === 0 ? values[endpoint.id] : ""),
    ));
}

export function maskApiKey(value) {
  const text = String(value || "");
  return text.length < 8 ? "****" : `${text.slice(0, 4)}...${text.slice(-3)}`;
}
