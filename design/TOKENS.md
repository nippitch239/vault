# Design tokens (from `DESIGN.md`)

Single source: `frontend/src/index.css` (CSS variables, light + dark) mapped in
`frontend/tailwind.config.js`. Components use only token classes (`bg-background`,
`text-muted-foreground`, `bg-primary`, `border-border`, `rounded-md`, `shadow-dialog`, …) —
no hex values or Tailwind palette colors (`slate-*`, `emerald-*`).

## Color

| Token | Dark (default) | Light | Spec role |
|---|---|---|---|
| `--background` | `#08090a` | `#f7f8f8` | Marketing black / light background |
| `--card` | `#0f1011` | `#ffffff` | Panel dark / card surface |
| `--popover` | `#191a1b` | `#ffffff` | Level-3 elevated surface |
| `--secondary`, `--muted`, `--accent` | `#191a1b` / `#191a1b` / `#28282c` | `#f3f4f5` / `#f3f4f5` / `#eef0f2` | Surfaces, hover |
| `--foreground` | `#f7f8f8` | `#0f1011` | Primary text (never pure white) |
| `--muted-foreground` | `#8a8f98` (6.1:1) | `#62666d` (5.4:1) | Tertiary text |
| `--border` / `--input` | `#23252a` / `#34343a` | `#e6e6e6` / `#d0d6e0` | Border primary / secondary |
| `--primary` | `#5e6ad2` (white text 4.7:1) | `#4752c4` (white text 6.4:1) | Brand indigo — CTAs and active state only |
| `--ring` | `#7170ff` | `#5e6ad2` | Accent violet focus ring |
| `--destructive` | `#dc2626` | `#dc2626` | Danger |
| `--success` / `-foreground` | `#0f2a18` / `#4cc76a` | `#e8f6ec` / `#1f7a35` | Status tint + text (≥ 4.8:1) |
| `--warning` / `-foreground` | `#2b2410` / `#f5c542` | `#fdf6db` / `#8a5a00` | |
| `--info` / `-foreground` | `#1b1d3a` / `#9ca3ff` | `#eceefc` / `#4752c4` | |
| `--error` / `-foreground` | `#2d1416` / `#f87171` | `#fdecec` / `#b91c1c` | |

Light mode uses `#4752c4` (the spec's pressed indigo) as primary because `#5e6ad2` on the light
background is 4.4:1, below WCAG AA for text.

## Typography

- `font-sans`: Inter (variable) + **Noto Sans Thai** for Thai glyphs, OpenType `cv01`, `ss03`.
- `font-mono`: JetBrains Mono (Berkeley Mono in the spec is a paid font).
- Weights: 400 body, **510** `font-ui` (labels, nav, buttons), **590** `font-strong` (headings); no 700.
- Scale used in the app: 12 / 13 / 14 / 16 / 20 / 24 / 32 px; display tracking `-0.022em`.

## Shape, depth, motion

| Token | Value |
|---|---|
| `--radius` (cards `rounded-lg`) | 8px; `rounded-md` 6px (buttons, inputs); `rounded-sm` 4px; `rounded-xl` 12px (panels) |
| `shadow-raised` | `0 2px 4px rgb(0 0 0 / .4), 0 0 0 1px rgb(255 255 255 / .05)` |
| `shadow-dialog` | spec Level-5 multi-layer stack |
| Motion | 150 ms (fast) / 200 ms (base), `cubic-bezier(0.2, 0, 0, 1)` |
| Overlay | `bg-black/85`-style backdrop via `--overlay` |
