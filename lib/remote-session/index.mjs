export { RemoteSessionError, REMOTE_SESSION_ERROR_STATUS } from "./domain/errors.mjs";
export {
  defaultRemoteSessionConfig,
  normalizeRemoteSessionConfig,
  validateRemoteSessionConfig,
  publicRemoteSessionConfigView,
} from "./domain/config-schema.mjs";
export {
  SESSION_STATES,
  canTransition,
} from "./domain/status.mjs";
export {
  createSessionRecord,
  transition,
  assertControllerAction,
} from "./domain/session.mjs";
export {
  MESSAGE_TYPES,
  encodeMessage,
  decodeMessage,
} from "./domain/protocol.mjs";
export {
  HOST_CAPABILITIES,
  HOST_EVENT_TYPES,
  summarizeHostBackend,
} from "./host-attach/contract.mjs";
export { probeLocalAntigravityBackend } from "./host-attach/probe.mjs";
export { createFakeHostBackend } from "./host-attach/fake-host.mjs";
export { createLocalHostBackend } from "./host-attach/local-host.mjs";
export {
  listProjectsFromStore,
  discoverDynamicLocalEndpoint,
  defaultProjectStoreDir,
  defaultAntigravityPaths,
} from "./host-attach/project-store.mjs";
export {
  listConversationsFromStore,
  getConversationFromStore,
  resolveConversationPaths,
  defaultBrainDir,
  extractUserRequest,
  extractModelSelection,
  readTranscriptEntries,
} from "./host-attach/conversation-store.mjs";
export {
  createLanguageServerConnectClient,
  discoverLanguageServerConnectEndpoint,
  summarizeTrajectoryList,
  summarizeTrajectoryDetail,
  inferModelFromTrajectoryDetail,
  inferRecommendedModelFromConfigData,
  pollTrajectoryEvents,
  trajectoryEventsSince,
  buildStartCascadeRequest,
  buildSendUserCascadeMessageRequest,
  buildCascadeConfig,
  buildRequestedModel,
  buildRequestedModelAlias,
  buildTextScopeItem,
  toFileUri,
  LANGUAGE_SERVER_SERVICE,
  CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT,
  CORTEX_TRAJECTORY_TYPE_CASCADE,
} from "./host-attach/language-server-connect.mjs";
export { resolveRemoteSessionPaths } from "./paths.mjs";
export { createMemoryEventLog } from "./transport/event-log.mjs";
export { createPeerClient, createPeerHostProxy } from "./transport/peer-client.mjs";
export { createRemoteSessionService } from "./application/service.mjs";
export { routeRemoteSessionRequest, sendRemoteSessionError } from "./http/routes.mjs";
