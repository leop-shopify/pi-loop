export const CHILD_AGENT_LIFECYCLE_PROBE = "pi-extended-teams:child-agent-lifecycle-probe";

export interface ChildAgentLifecycleSnapshot {
  sessionId: string;
  running: number;
  queued: number;
}

type LifecycleProbeBus = {
  events?: {
    emit(name: string, payload: unknown): void;
  };
};

export function probeChildAgentLifecycle(bus: LifecycleProbeBus, sessionId: string): ChildAgentLifecycleSnapshot | null {
  let snapshot: ChildAgentLifecycleSnapshot | null = null;
  if (typeof bus.events?.emit !== "function") return snapshot;

  bus.events.emit(CHILD_AGENT_LIFECYCLE_PROBE, {
    sessionId,
    respond(candidate: ChildAgentLifecycleSnapshot) {
      if (candidate.sessionId !== sessionId) return;
      snapshot = candidate;
    },
  });
  return snapshot;
}

export function childAgentsPending(snapshot: ChildAgentLifecycleSnapshot): boolean {
  return snapshot.running > 0 || snapshot.queued > 0;
}
