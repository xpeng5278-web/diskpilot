# DiskPilot design system

This is DiskPilot's own UI guide, inspired by the flat, structured approach in
[Awesome DESIGN.md's IBM analysis](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/ibm/DESIGN.md).
It is not an IBM product, and must not use IBM marks or imply affiliation.

## Product character

DiskPilot is a local disk-analysis workbench. Show scope, progress, evidence, and
review actions before decorative branding. The first screen is the scan tool.
Keep destructive or migration actions absent until they can be verified and
reversed. Explain that recommendations are not automatic file operations.

## Color and surfaces

| Role | Token |
| --- | --- |
| Canvas | `#ffffff` |
| Subtle surface | `#f4f4f4` |
| Strong surface | `#e0e0e0` |
| Primary text | `#161616` |
| Muted text | `#525252` |
| Hairline | `#d9d9d9` |
| Action blue | `#0f62fe` |
| Action hover | `#0043ce` |
| Success | `#198038` |
| Warning | `#b28600` |
| Error | `#da1e28` |

Use blue for commands, selection, and keyboard focus, not as a large decorative
background. Use distinct muted colors for chart categories and status semantics.
Never rely on color alone to convey a scan state.

## Type and spacing

Prefer IBM Plex Sans if installed, then Segoe UI / Microsoft YaHei UI. Keep
letter spacing at zero. Body text is 13-14px with comfortable line height;
headings inside the workbench are 16-24px, not hero scale. Use 4/8/12/16/24/32px
spacing increments. Keep numeric measurements tabular and paths selectable.

## Components

- Buttons, inputs, tabs, data bands, and notices use 0px corner radius.
- Primary buttons are blue with white text. Secondary actions are neutral.
- Inputs use a gray fill and a clear blue focus outline/underline.
- Scan scope is a two-column unframed work area on desktop and one column below
  900px. The full fixed-disk command is prominent but never runs automatically.
- Progress shows the active drive. The WizTree stage is indeterminate; only CSV
  parsing may show a percentage based on bytes read.
- Tables use thin row rules and a neutral header. Category bars may use multiple
  colors to support scanning, but labels and numbers carry the meaning.
- Use a 48px minimum touch target on narrow screens. At 650px, controls and
  results collapse without horizontal page overflow.

## Avoid

No gradients, floating cards, pills, glow, shadows, giant headlines, nested
cards, decorative icons, or marketing copy in the scan workspace. Do not claim
that allocated bytes equal logical file size or guaranteed reclaimable space.
Do not hide failures, skipped items, or a stale report after service restart.
