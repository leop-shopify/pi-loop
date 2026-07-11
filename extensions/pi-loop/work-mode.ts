export const WORK_MODE_PROBE = "pi-work-mode:probe";
export const WORK_MODE_CAPABILITY_PROBE = "pi-work-mode:capability-probe";

export type WorkMode = "goal" | "scheduled_run";

export type WorkModeState = {
  owner: string;
  mode: WorkMode;
  active: boolean;
};

type ProbePayload = {
  respond: (state: WorkModeState) => void;
};

type CapabilityPayload = {
  respond: (owner: string) => void;
};

type WorkModeBus = {
  events?: {
    on: (name: string, handler: (payload: unknown) => void) => (() => void) | void;
    emit: (name: string, payload: unknown) => void;
  };
};

export function registerWorkMode(bus: WorkModeBus, state: () => WorkModeState | null): (() => void) | void {
  if (!bus.events) return;
  return bus.events.on(WORK_MODE_PROBE, (payload) => {
    const current = state();
    if (current?.active) (payload as ProbePayload).respond(current);
  });
}

export function registerWorkModeCapability(bus: WorkModeBus, owner: string): (() => void) | void {
  if (!bus.events) return;
  return bus.events.on(WORK_MODE_CAPABILITY_PROBE, (payload) => (payload as CapabilityPayload).respond(owner));
}

export function probeWorkModeCapabilities(bus: WorkModeBus): string[] {
  const owners: string[] = [];
  if (!bus.events) return owners;
  bus.events.emit(WORK_MODE_CAPABILITY_PROBE, { respond: (owner: string) => owners.push(owner) });
  return owners;
}

export function probeWorkModes(bus: WorkModeBus, excludeOwner?: string): WorkModeState[] {
  const states: WorkModeState[] = [];
  if (!bus.events) return states;
  bus.events.emit(WORK_MODE_PROBE, {
    respond(state: WorkModeState) {
      if (state.active && state.owner !== excludeOwner) states.push(state);
    },
  });
  return states;
}
