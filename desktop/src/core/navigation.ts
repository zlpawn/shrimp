import { state } from "./state";

type TabHooks = { onEnter?: () => void; onLeave?: () => void };

const tabHooks = new Map<string, TabHooks>();

export function registerTab(tabId: string, hooks: TabHooks): void {
  tabHooks.set(tabId, hooks);
}

export function runTabEnter(tabId: string): void {
  tabHooks.get(tabId)?.onEnter?.();
}

export function runTabLeave(tabId: string): void {
  tabHooks.get(tabId)?.onLeave?.();
}
