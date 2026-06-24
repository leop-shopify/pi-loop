import { createLoopState, type LoopRuntimeState } from "./state.ts";

export interface RuntimeStore {
  ensure(sessionKey: string): LoopRuntimeState;
  clear(sessionKey: string): void;
}

export function createRuntimeStore(): RuntimeStore {
  const states = new Map<string, LoopRuntimeState>();
  return {
    ensure(sessionKey: string): LoopRuntimeState {
      let state = states.get(sessionKey);
      if (!state) {
        state = createLoopState();
        states.set(sessionKey, state);
      }
      return state;
    },
    clear(sessionKey: string): void {
      const state = states.get(sessionKey);
      if (state?.pendingResumeTimer) clearTimeout(state.pendingResumeTimer);
      states.delete(sessionKey);
    },
  };
}
