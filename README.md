# Resizable Stacked Tabs

Drag a stacked tab's right edge to set its width without leaving stacked-tab mode.

## Use

In Obsidian's stacked-tab layout, drag the right edge of a tab to resize it. Widths are remembered for the tab. Run **Reset active stacked tab width** or **Reset all stacked tab widths** from the command palette to restore defaults. Set minimum and maximum widths under **Settings → Resizable Stacked Tabs**.

## Install manually

Run `npm ci && npm run build`, then copy `manifest.json`, `main.js`, and `styles.css` into `<vault>/.obsidian/plugins/resizable-stacked-tabs/`. Enable the plugin under **Settings → Community plugins**.

## Develop

Run `npm ci` and `npm run build` from this directory.

## License

MIT. See [LICENSE](LICENSE).
