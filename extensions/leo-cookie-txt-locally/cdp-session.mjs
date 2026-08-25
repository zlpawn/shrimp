import { lanternError } from "./errors.mjs";
import {
  createNetworkBuffer,
  createNetworkSession,
  filterNetworkEntries,
  getNetworkEntries,
  toNetworkSummary,
  upsertNetworkEntry,
} from "./network-capture.mjs";

export function createCdpSessionManager({
  debuggerApi,
  validateTab,
  persist,
  now = Date.now,
  entryLimit = 1_000,
} = {}) {
  if (!debuggerApi) throw new TypeError("CDP session manager requires debuggerApi");
  if (typeof validateTab !== "function") throw new TypeError("CDP session manager requires validateTab");
  if (typeof persist !== "function") throw new TypeError("CDP session manager requires persist");

  let activeSession = null;
  let runtimeBuffer = createNetworkBuffer(entryLimit);

  function requireSession(tabId) {
    if (!activeSession || activeSession.stoppedAt != null) {
      throw lanternError("capture_not_active", "Network capture is not running");
    }
    if (tabId !== null && tabId !== undefined && Number(tabId) !== Number(activeSession.tabId)) {
      throw lanternError(
        "capture_tab_mismatch",
        `Network capture belongs to tab ${activeSession.tabId}, not tab ${tabId}`
      );
    }
    return activeSession;
  }

  function materialize({ grep = "" } = {}) {
    const session = requireSession();
    const entries = filterNetworkEntries(getNetworkEntries(runtimeBuffer), grep).map(toNetworkSummary);
    return {
      running: true,
      tabId: session.tabId,
      startedAt: session.startedAt,
      recovered: session.recovered,
      entriesLost: session.entriesLost,
      entryCount: session.entryCount,
      entries,
    };
  }

  async function detachOwned(session) {
    try {
      await debuggerApi.sendCommand({ tabId: session.tabId }, "Network.disable");
    } finally {
      if (session.attachedByLantern) {
        await debuggerApi.detach({ tabId: session.tabId });
      }
    }
  }

  async function start({ tabId } = {}) {
    const validatedTabId = Number(await validateTab(tabId));
    if (activeSession && activeSession.stoppedAt == null && Number(activeSession.tabId) === validatedTabId) {
      runtimeBuffer = createNetworkBuffer(entryLimit);
      activeSession = {
        ...activeSession,
        startedAt: now(),
        stoppedAt: null,
        entryCount: 0,
        recovered: false,
        entriesLost: false,
      };
      await persist(activeSession);
      return { ...activeSession };
    }

    if (activeSession && activeSession.stoppedAt == null) {
      await stop({ tabId: activeSession.tabId });
    }

    let acquiredAttachment = false;
    try {
      await debuggerApi.attach({ tabId: validatedTabId }, "1.3");
      acquiredAttachment = true;
      await debuggerApi.sendCommand({ tabId: validatedTabId }, "Network.enable");
      runtimeBuffer = createNetworkBuffer(entryLimit);
      activeSession = createNetworkSession({
        tabId: validatedTabId,
        attachedByLantern: true,
        startedAt: now(),
      });
      await persist(activeSession);
      return { ...activeSession };
    } catch (error) {
      activeSession = null;
      runtimeBuffer = createNetworkBuffer(entryLimit);
      if (acquiredAttachment) {
        try {
          await debuggerApi.detach({ tabId: validatedTabId });
        } catch {}
      }
      throw lanternError("debugger_attach_failed", error?.message || "Failed to start network capture");
    }
  }

  function get({ tabId = null, grep = "" } = {}) {
    requireSession(tabId);
    return materialize({ grep });
  }

  async function stop({ tabId = null, grep = "" } = {}) {
    const session = requireSession(tabId);
    const entries = filterNetworkEntries(getNetworkEntries(runtimeBuffer), grep).map(toNetworkSummary);
    try {
      await detachOwned(session);
    } catch (error) {
      throw lanternError("debugger_attach_failed", error?.message || "Failed to stop network capture");
    }
    const stopped = {
      ...session,
      stoppedAt: now(),
      entryCount: runtimeBuffer.entriesById.size,
    };
    activeSession = null;
    runtimeBuffer = createNetworkBuffer(entryLimit);
    await persist(stopped);
    return { stopped: true, ...stopped, entries };
  }

  function handleNetworkEvent(source, method, params) {
    if (!activeSession || Number(source?.tabId) !== Number(activeSession.tabId) || !params?.requestId) {
      return false;
    }
    if (method === "Network.requestWillBeSent") {
      upsertNetworkEntry(runtimeBuffer, {
        requestId: params.requestId,
        method: params.request?.method,
        url: params.request?.url,
        type: params.type,
        timestamp: params.timestamp,
      });
    } else if (method === "Network.responseReceived") {
      upsertNetworkEntry(runtimeBuffer, {
        requestId: params.requestId,
        status: params.response?.status,
        mimeType: params.response?.mimeType,
      });
    } else {
      return false;
    }
    activeSession.entryCount = runtimeBuffer.entriesById.size;
    return true;
  }

  async function reconcile(durableSession) {
    if (!durableSession || durableSession.stoppedAt != null) {
      activeSession = null;
      runtimeBuffer = createNetworkBuffer(entryLimit);
      return null;
    }

    let validatedTabId;
    try {
      validatedTabId = Number(await validateTab(durableSession.tabId));
    } catch (error) {
      const targets = await debuggerApi.getTargets();
      const target = targets.find((item) => Number(item.tabId) === Number(durableSession.tabId));
      if (target?.attached && durableSession.attachedByLantern) {
        try {
          await debuggerApi.detach({ tabId: Number(durableSession.tabId) });
        } catch {}
      }
      activeSession = null;
      runtimeBuffer = createNetworkBuffer(entryLimit);
      await persist(null);
      return null;
    }

    const targets = await debuggerApi.getTargets();
    const target = targets.find((item) => Number(item.tabId) === validatedTabId);
    if (!target?.attached) {
      const stopped = { ...durableSession, stoppedAt: now(), entryCount: 0 };
      activeSession = null;
      runtimeBuffer = createNetworkBuffer(entryLimit);
      await persist(stopped);
      return stopped;
    }

    activeSession = createNetworkSession({
      ...durableSession,
      tabId: validatedTabId,
      stoppedAt: null,
      entryCount: 0,
      recovered: true,
      entriesLost: true,
    });
    runtimeBuffer = createNetworkBuffer(entryLimit);
    await persist(activeSession);
    return { ...activeSession };
  }

  async function handleDetach(source) {
    if (!activeSession || Number(source?.tabId) !== Number(activeSession.tabId)) return false;
    activeSession = null;
    runtimeBuffer = createNetworkBuffer(entryLimit);
    await persist(null);
    return true;
  }

  return {
    start,
    get,
    stop,
    reconcile,
    handleDetach,
    handleNetworkEvent,
  };
}
