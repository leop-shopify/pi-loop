import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, OverlayHandle, OverlayOptions, TUI } from "@earendil-works/pi-tui";

interface FloatingPanelEntry<T> {
  component?: FloatingPanelComponent<T>;
  handle?: OverlayHandle;
}

type PanelRenderer<T> = (state: T, width: number, theme: Theme, height?: number) => string[];

const panels = new Map<string, FloatingPanelEntry<unknown>>();

export function floatingPanelOverlayOptions(): OverlayOptions {
  return {
    anchor: "right-center",
    width: "60%",
    minWidth: 36,
    maxHeight: "100%",
    margin: { right: 1 },
    nonCapturing: true,
    visible: (termWidth) => termWidth >= 80,
  };
}

export function showFloatingPanel<T>(ctx: ExtensionContext, key: string, state: T, render: PanelRenderer<T>): boolean {
  const custom = (ctx.ui as ExtensionContext["ui"] & { custom?: ExtensionContext["ui"]["custom"] }).custom;
  if (!ctx.hasUI || typeof custom !== "function") return false;

  const id = panelKey(ctx, key);
  const existing = panels.get(id) as FloatingPanelEntry<T> | undefined;
  if (existing?.component) {
    existing.component.update(state);
    return true;
  }

  const entry: FloatingPanelEntry<T> = {};
  panels.set(id, entry as FloatingPanelEntry<unknown>);

  const result = custom.call(ctx.ui, (tui: TUI, theme: Theme, _keybindings, done: (value: void) => void) => {
    const component = new FloatingPanelComponent(tui, theme, state, render, () => {
      panels.delete(id);
      done(undefined);
    });
    entry.component = component;
    return component;
  }, {
    overlay: true,
    overlayOptions: floatingPanelOverlayOptions,
    onHandle: (handle) => {
      entry.handle = handle;
    },
  });

  if (result && typeof result.catch === "function") {
    void result.catch(() => {
      panels.delete(id);
    });
  }

  return true;
}

export function hideFloatingPanel(ctx: ExtensionContext, key: string): void {
  const id = panelKey(ctx, key);
  const entry = panels.get(id);
  if (!entry) return;
  panels.delete(id);
  if (entry.handle) entry.handle.hide();
  else entry.component?.dispose();
}

function panelKey(ctx: ExtensionContext, key: string): string {
  return `${ctx.sessionManager.getSessionId()}:${key}`;
}

function targetPanelHeight(rows: number): number {
  const options = floatingPanelOverlayOptions();
  const margin = typeof options.margin === "number" ? { top: options.margin, bottom: options.margin } : options.margin ?? {};
  const marginRows = (margin.top ?? 0) + (margin.bottom ?? 0);
  return Math.max(1, rows - marginRows);
}

class FloatingPanelComponent<T> implements Component {
  private closed = false;
  private readonly tui: TUI;
  private readonly theme: Theme;
  private state: T;
  private readonly renderPanel: PanelRenderer<T>;
  private readonly onDispose: () => void;

  constructor(tui: TUI, theme: Theme, state: T, renderPanel: PanelRenderer<T>, onDispose: () => void) {
    this.tui = tui;
    this.theme = theme;
    this.state = state;
    this.renderPanel = renderPanel;
    this.onDispose = onDispose;
  }

  update(state: T): void {
    this.state = state;
    this.tui.requestRender();
  }

  render(width: number): string[] {
    return this.renderPanel(this.state, width, this.theme, targetPanelHeight(this.tui.terminal.rows));
  }

  invalidate(): void {}

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.onDispose();
  }
}
