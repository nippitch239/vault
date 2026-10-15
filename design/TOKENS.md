# Design tokens — "Vault" theme

Single source: `frontend/src/index.css` (CSS variables, light + dark) mapped in
`frontend/tailwind.config.js`. Components use only token classes (`bg-background`, `bg-card`,
`text-muted-foreground`, `bg-primary`, `border-border`, `rounded-lg`, `shadow-glow`, …) — no hex
values or Tailwind palette colors.

## History

1. Step 3 started from the Open Design **Linear-inspired** system (`design/DESIGN.md`, kept for
   reference with its Apache-2.0 license).
2. The product owner then asked for the look of the Webflow **"Vault" SaaS template**
   (https://webflow.com/templates/html/vault-saas-website-template). That template is a paid
   product, so **none of its HTML, CSS, images, logo or text is used**; the theme below recreates
   the *feel* (palette, typography, pill buttons, glow, layout) on our own tokens and components.
   The token *names* did not change, so every page switched theme without per-page edits.

## Color

| Token | Dark (default) | Light | Role |
|---|---|---|---|
| `--background` | `#050009` | `#f8f4fc` | Page; dark has violet corner glow (`--glow`) on `<body>` |
| `--card` | `#0c0614` (80% + blur) | `#ffffff` | Cards (`card-glow` inner highlight) |
| `--popover` | `#150b22` | `#ffffff` | Dialogs, menus |
| `--secondary`, `--muted`, `--accent` | `#1e1230` | `#efe6f8` | Surfaces, hover |
| `--foreground` | `#fffafa` (20:1) | `#14091f` (17.8:1) | Text |
| `--secondary-foreground` | `#eed6fe` lavender | `#14091f` | Secondary text |
| `--muted-foreground` | `#a99db5` (8.1:1) | `#625870` (6.1:1) | Tertiary text |
| `--border` / `--input` | `#2b2238` / `#3b2f4a` | `#e4d9ef` / `#cdbfdc` | Hairlines, controls |
| `--primary` / `--primary-glow` | `#6804ab` / `#8b2fd6` | same | CTA gradient (white text 9.3:1 / 5.8:1) |
| `--ring` | `#b77cff` | `#6804ab` | Focus ring |
| `--success/-warning/-info/-error` (+ `-foreground`) | dark tints with ≥ 7:1 text | light tints with ≥ 4.8:1 text | Status |

## Typography

- `font-sans`: **Kanit** (Thai + Latin, Google Fonts, SIL OFL) 200–600; `font-mono`: JetBrains Mono.
- Body 300, `font-ui` 400 (labels, buttons, nav), `font-strong` 500 (headings); no 700.
- Landing hero: `text-4xl sm:text-6xl lg:text-7xl`, uppercase Latin, `.text-gradient`.

## Shape, depth, motion

| Token | Value |
|---|---|
| Buttons, chips, badges | `rounded-full` pills |
| `rounded-md` / `rounded-lg` / `rounded-xl` | 12px controls / 20px cards / 24px dialogs |
| `shadow-glow`, `shadow-glow-sm` | violet glow for the main CTA / active items |
| `.card-glow` | 1px inner highlight + soft violet drop glow |
| `.bg-grid` | faint 56px grid behind hero sections |
| Motion | 150 ms / 200 ms, `cubic-bezier(0.2, 0, 0, 1)`; `prefers-reduced-motion` respected |
