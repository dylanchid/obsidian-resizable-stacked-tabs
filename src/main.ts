import { Plugin, PluginSettingTab, Setting, WorkspaceLeaf } from "obsidian";

interface ResizableStackedTabsSettings {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  widths: Record<string, number>;
}

const DEFAULT_SETTINGS: ResizableStackedTabsSettings = {
  defaultWidth: 520,
  minWidth: 260,
  maxWidth: 1800,
  widths: {},
};

const PANE_CLASS = "resizable-stacked-tabs-pane";
const HANDLE_CLASS = "resizable-stacked-tabs-handle";

interface DragState {
  leaf: WorkspaceLeaf;
  startX: number;
  startWidth: number;
}

/**
 * Adds a right-edge resize affordance to Obsidian's native stacked tabs.
 *
 * Width is deliberately applied to the leaf, not to WorkspaceTabs internals:
 * Obsidian continues to own selection, focus, and the stacked-tab animation.
 */
export default class ResizableStackedTabsPlugin extends Plugin {
  settings: ResizableStackedTabsSettings = DEFAULT_SETTINGS;
  private drag: DragState | null = null;
  private saveTimer: number | null = null;
  private observer: MutationObserver | null = null;
  private refreshFrame: number | null = null;

  async onload() {
    const saved = await this.loadData() as Partial<ResizableStackedTabsSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...saved,
      widths: { ...saved?.widths },
    };

    this.addSettingTab(new ResizableStackedTabsSettingTab(this.app, this));
    this.addCommand({
      id: "reset-active-stacked-tab-width",
      name: "Reset active stacked tab width",
      callback: () => {
        const leaf = this.app.workspace.getMostRecentLeaf();
        if (!leaf) return;
        delete this.settings.widths[leaf.id];
        this.clearWidth(leaf);
        this.queueSave();
      },
    });
    this.addCommand({
      id: "reset-all-stacked-tab-widths",
      name: "Reset all stacked tab widths",
      callback: () => {
        this.settings.widths = {};
        this.refresh();
        this.queueSave();
      },
    });

    this.registerEvent(this.app.workspace.on("layout-change", () => this.refresh()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refresh()));
    this.registerDomEvent(window, "mousemove", (event) => this.onMouseMove(event));
    this.registerDomEvent(window, "mouseup", () => this.stopDrag());
    this.registerDomEvent(window, "blur", () => this.stopDrag());
    this.registerDomEvent(window, "resize", () => this.refresh());
    this.app.workspace.onLayoutReady(() => {
      this.refresh();
      this.observeWorkspace();
    });
  }

  /**
   * Opening, closing, or moving a tab, or toggling stacked mode, can alter the DOM without
   * emitting layout-change. Watch only structural changes, so our own handle/class/width
   * writes inside a leaf never re-trigger a refresh.
   */
  private observeWorkspace() {
    const isStructural = (node: Node) =>
      node instanceof HTMLElement &&
      (node.matches(".workspace-leaf, .workspace-tabs, .workspace-split") ||
        node.querySelector(".workspace-leaf") !== null);

    this.observer = new MutationObserver((records) => {
      const relevant = records.some((record) =>
        record.type === "attributes"
          ? (record.target as HTMLElement).classList.contains("workspace-tabs")
          : [...record.addedNodes, ...record.removedNodes].some(isStructural),
      );
      if (relevant) this.scheduleRefresh();
    });
    this.observer.observe(this.app.workspace.containerEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  private scheduleRefresh() {
    if (this.refreshFrame !== null) return;
    this.refreshFrame = window.requestAnimationFrame(() => {
      this.refreshFrame = null;
      this.refresh();
    });
  }

  onunload() {
    this.stopDrag();
    this.observer?.disconnect();
    if (this.refreshFrame !== null) window.cancelAnimationFrame(this.refreshFrame);
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.app.workspace.iterateAllLeaves((leaf) => this.clearWidth(leaf));
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  refresh() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const pane = this.getPane(leaf);
      if (!pane || !this.isInStackedTabs(pane)) {
        this.clearWidth(leaf);
        return;
      }

      pane.addClass(PANE_CLASS);
      const width = this.settings.widths[leaf.id];
      if (width) this.applyWidth(leaf, width);
      else this.clearInlineWidth(pane);
      this.ensureHandle(leaf, pane);
    });
  }

  private getPane(leaf: WorkspaceLeaf): HTMLElement | null {
    return (leaf as WorkspaceLeaf & { containerEl?: HTMLElement }).containerEl ?? null;
  }

  private isInStackedTabs(pane: HTMLElement): boolean {
    return pane.closest(".workspace-tabs.mod-stacked") !== null;
  }

  private ensureHandle(leaf: WorkspaceLeaf, pane: HTMLElement) {
    let handle = pane.querySelector<HTMLElement>(`:scope > .${HANDLE_CLASS}`);
    if (handle) return;

    handle = pane.createDiv({
      cls: HANDLE_CLASS,
      attr: {
        role: "separator",
        "aria-orientation": "vertical",
        "aria-label": "Drag to resize this stacked tab",
        tabindex: "0",
      },
    });
    this.registerDomEvent(handle, "mousedown", (event: MouseEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.startDrag(leaf, event.clientX);
    });
  }

  private startDrag(leaf: WorkspaceLeaf, clientX: number) {
    const pane = this.getPane(leaf);
    if (!pane || !this.isInStackedTabs(pane)) return;
    const stored = this.settings.widths[leaf.id];
    this.drag = {
      leaf,
      startX: clientX,
      startWidth: stored ?? pane.getBoundingClientRect().width ?? this.settings.defaultWidth,
    };
    document.body.addClass("resizable-stacked-tabs-is-dragging");
  }

  private onMouseMove(event: MouseEvent) {
    if (!this.drag) return;
    const next = this.clamp(this.drag.startWidth + event.clientX - this.drag.startX);
    this.settings.widths[this.drag.leaf.id] = next;
    this.applyWidth(this.drag.leaf, next);
  }

  private stopDrag() {
    if (!this.drag) return;
    this.drag = null;
    document.body.removeClass("resizable-stacked-tabs-is-dragging");
    this.queueSave();
  }

  private clamp(width: number): number {
    return Math.round(Math.max(this.settings.minWidth, Math.min(this.settings.maxWidth, width)));
  }

  private applyWidth(leaf: WorkspaceLeaf, width: number) {
    const pane = this.getPane(leaf);
    if (!pane) return;
    const value = `${this.clamp(width)}px`;
    // Flex-basis is the dimension Obsidian's stacked-tabs layout uses; width and
    // min-width make the override resilient across minor Obsidian CSS changes.
    pane.style.setProperty("--resizable-stacked-tab-width", value);
    pane.style.setProperty("flex", `0 0 ${value}`, "important");
    pane.style.setProperty("width", value, "important");
    pane.style.setProperty("min-width", value, "important");
  }

  private clearInlineWidth(pane: HTMLElement) {
    pane.style.removeProperty("--resizable-stacked-tab-width");
    pane.style.removeProperty("flex");
    pane.style.removeProperty("width");
    pane.style.removeProperty("min-width");
  }

  private clearWidth(leaf: WorkspaceLeaf) {
    const pane = this.getPane(leaf);
    if (!pane) return;
    this.clearInlineWidth(pane);
    pane.removeClass(PANE_CLASS);
    pane.querySelector(`:scope > .${HANDLE_CLASS}`)?.remove();
  }

  private queueSave() {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveSettings();
    }, 180);
  }
}

class ResizableStackedTabsSettingTab extends PluginSettingTab {
  constructor(app: import("obsidian").App, private plugin: ResizableStackedTabsPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("p", {
      text: "Drag the slim right-edge grip on any native stacked tab. Widths are saved per workspace tab.",
    });
    new Setting(containerEl)
      .setName("Minimum width")
      .setDesc("The narrowest a stacked tab can become.")
      .addText((text) => text.setValue(String(this.plugin.settings.minWidth)).onChange((value) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return;
        this.plugin.settings.minWidth = Math.max(120, Math.round(n));
        if (this.plugin.settings.maxWidth < this.plugin.settings.minWidth) {
          this.plugin.settings.maxWidth = this.plugin.settings.minWidth;
        }
        void this.plugin.saveSettings();
        this.plugin.refresh();
      }));
    new Setting(containerEl)
      .setName("Maximum width")
      .setDesc("The widest a stacked tab can become.")
      .addText((text) => text.setValue(String(this.plugin.settings.maxWidth)).onChange((value) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return;
        this.plugin.settings.maxWidth = Math.max(this.plugin.settings.minWidth, Math.round(n));
        void this.plugin.saveSettings();
        this.plugin.refresh();
      }));
  }
}
