import { NatTraversalError } from "../domain/errors.mjs";
import { createFrpcProvider } from "./frpc.mjs";
import { createCloudflaredProvider } from "./cloudflared.mjs";

export function createProviderRegistry({
  paths,
  logger = console,
  supervisorFactory,
  cloudflaredSupervisorFactory,
  cloudflaredRunner,
  whichBin,
} = {}) {
  const providers = new Map();

  function register(provider) {
    if (!provider?.id) {
      throw new NatTraversalError("invalid_request", "provider.id is required");
    }
    providers.set(provider.id, provider);
  }

  // Built-in providers
  register(createFrpcProvider({ paths, logger, supervisorFactory, whichBin }));
  register(
    createCloudflaredProvider({
      paths,
      logger,
      supervisorFactory: cloudflaredSupervisorFactory,
      cloudflaredRunner,
      whichBin,
    }),
  );


  function get(id) {
    const provider = providers.get(id);
    if (!provider) {
      throw new NatTraversalError(
        "provider_not_found",
        `provider '${id}' not found`,
      );
    }
    return provider;
  }

  function list() {
    return [...providers.values()].map((provider) => ({
      id: provider.id,
      capabilities: provider.capabilities?.() || [],
    }));
  }

  return { register, get, list };
}
