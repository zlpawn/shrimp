import { listEndpointCredentials } from "./credential-store.mjs";

const EMPTY_CREDENTIAL = Object.freeze({
  credentialId: null,
  apiKey: "",
});

export function createKeyStrategyRegistry({
  counterStore = new Map(),
  random = Math.random,
} = {}) {
  const strategies = new Map();
  const registry = {
    register(name, selector) {
      strategies.set(name, selector);
      return registry;
    },
    select(name, input) {
      const selector = strategies.get(name) || strategies.get("failover");
      return selector?.(input) || EMPTY_CREDENTIAL;
    },
  };

  registry.register("failover", ({ credentials, context }) =>
    credentials[Number(context?.attempt || 0)] || EMPTY_CREDENTIAL);

  registry.register("round-robin", ({ endpoint, credentials }) => {
    if (!credentials.length) return EMPTY_CREDENTIAL;
    const next = counterStore.get(endpoint.id) || 0;
    counterStore.set(endpoint.id, (next + 1) % credentials.length);
    return credentials[next % credentials.length];
  });

  registry.register("random", ({ credentials }) => {
    if (!credentials.length) return EMPTY_CREDENTIAL;
    return credentials[Math.floor(random() * credentials.length)];
  });

  return registry;
}

export const defaultKeyStrategyRegistry = createKeyStrategyRegistry();

export function selectEndpointCredential(
  endpoint,
  secrets,
  env = process.env,
  context = {},
  registry = defaultKeyStrategyRegistry,
) {
  const credentials = listEndpointCredentials(endpoint, secrets, env);
  return registry.select(endpoint?.key_strategy || "failover", {
    endpoint,
    credentials,
    context,
  });
}
