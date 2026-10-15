# Project: SecureVault - Modern shadcn/solid-ui UI/UX Overhaul

## Architecture & System Overview
SecureVault is an enterprise-grade Zero-Knowledge password and secrets manager built on React 18, Vite, and Tailwind CSS on the client, backed by Node.js serverless REST API handlers with SQLite/PostgreSQL.
This project refactors and upgrades SecureVault's UI/UX to match the modern `shadcn/solid-ui` design system:
- **Design Tokens & Theme Foundation**: Neutral dark/light theme HSL CSS variables (`--background`, `--card`, `--popover`, `--primary`, `--muted`, `--border`, `--ring`, `--destructive`, `--radius: 0.5rem`, and sidebar tokens) in `src/client/src/index.css`, mapped into `src/client/tailwind.config.js` with full opacity modifier support (`bg-primary/90`, `bg-background/80`).
- **Modern UI Component Primitives (`src/client/src/components/ui/`)**: Reusable React 18 components matching `solid-ui` specifications: `Button`, `Card`, `Badge`, `Table`, `DropdownMenu`, `Dialog`, `Sheet`, `Input`, `Slider`, `Command`, `Avatar`, `Tooltip`.
- **Navigation & App Shell (`src/client/src/components/Layout/`)**: Left collapsible sidebar / rail navigation (`Sidebar.jsx` with expanded `16rem` and icon-only `3rem` rail, keyboard shortcut `Cmd+B`, mobile drawer) and sticky top header (`AppHeader.jsx`, `z-40`) featuring `Cmd+K` command search, interactive vault lock indicator, security notification bell, and user avatar dropdown.
- **Vault Dashboard & Data Display (`src/client/src/components/Vault/`)**: Modern `VaultDashboard.jsx` featuring Card grid and Table views, category badges, favorite stars, contextual dropdown actions (`DropdownMenu`), and auto-clearing clipboard toast.
- **Accessible Modals & Embedded Generator (`src/client/src/components/Vault/`, `src/client/src/components/Security/`)**: Bounded viewport height (`max-h-[85vh]` with internal scroll), `z-[60]` layer hierarchy for `ItemModal`, `ShareModal`, `HistoryDrawer`, `SecurityNotificationModal`. Embedded password generator with compact slider and Diceware passphrase selector.
- **Zero-Knowledge Cryptographic Preservation**: Dual-key derivation (Argon2id + HKDF), AES-256-GCM authenticated vault payload encryption, RSA-OAEP-SHA256 key wrapping, and CSPRNG Diceware generator remain 100% genuine, unaltered, and functional.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | HSL Theme Tokens & CSS Properties | Define neutral dark/light theme CSS custom properties in `src/client/src/index.css` | M1 | ORIGINAL_REQUEST §R1 |
| 2 | Tailwind CSS Token Configuration | Map HSL CSS variables into `src/client/tailwind.config.js` with color opacity, radii, and keyframes | M1 | ORIGINAL_REQUEST §R1 |
| 3 | Core UI Primitives: Button, Card, Badge, Input | Implement `Button`, `Card`, `Badge`, and `Input` React components matching `solid-ui` styles | M1 | ORIGINAL_REQUEST §R1, §R3 |
| 4 | Core UI Primitives: Dialog, Sheet, DropdownMenu | Implement `Dialog`, `Sheet`, and `DropdownMenu` with backdrop blur, animations, and portal semantics | M1 | ORIGINAL_REQUEST §R1, §R4 |
| 5 | Collapsible Left Sidebar & Rail Navigation | Implement `Sidebar.jsx` with expanded (16rem), icon-only (3rem) rail, and mobile sheet modes | M2 | ORIGINAL_REQUEST §R2 |
| 6 | Navigation Hierarchy & Routing | Organize navigation into Vault (Vault, Shared, Collections, Groups) and Observability (Activity, Audit, Monitoring) | M2 | ORIGINAL_REQUEST §R2 |
| 7 | Top Sticky Header & Cmd+K Command Search | Implement `AppHeader.jsx` with `Cmd+K` command search palette, lock status, notification bell, user avatar | M2 | ORIGINAL_REQUEST §R2 |
| 8 | Keyboard Shortcuts (Cmd+K, Cmd+B) | Global listener for `Cmd+K` / `Ctrl+K` (search) and `Cmd+B` / `Ctrl+B` (toggle sidebar) | M2 | ORIGINAL_REQUEST §R2 |
| 9 | Vault Dashboard Table & Grid Views | Modern data display in `VaultDashboard.jsx` supporting both Table view and Card grid view | M3 | ORIGINAL_REQUEST §R3 |
| 10 | Category Badges & Favorite Stars | Visual category pill badges (Login, Card, Note, Identity) and interactive favorite stars | M3 | ORIGINAL_REQUEST §R3 |
| 11 | Contextual Actions DropdownMenu | Dropdown with Copy Username, Copy Password, Edit, Share, History, Delete actions | M3 | ORIGINAL_REQUEST §R3 |
| 12 | Auto-Clearing Clipboard Toast | Toast notification that automatically clears clipboard after 30 seconds for password security | M3 | ORIGINAL_REQUEST §R3 |
| 13 | Viewport-Bounded ItemModal | Upgrade `ItemModal.jsx` to `Dialog` styling with `max-h-[85vh]`, internal scroll, and collection selector | M4 | ORIGINAL_REQUEST §R4 |
| 14 | Embedded Password & Diceware Generator | Password generator inside `ItemModal` with compact slider, Diceware passphrase selector, and strength score | M4 | ORIGINAL_REQUEST §R4 |
| 15 | Viewport-Bounded ShareModal & HistoryDrawer | Upgrade `ShareModal.jsx` and `HistoryDrawer.jsx` with bounded viewport, `Sheet` styling, and ZK decryption | M4 | ORIGINAL_REQUEST §R4 |
| 16 | SecurityNotificationModal & Z-Index Layering | Upgrade `SecurityNotificationModal.jsx` with `z-[60]` layer hierarchy correctly overlaying backdrops | M4 | ORIGINAL_REQUEST §R4 |
| 17 | Zero-Knowledge Cryptographic Verification | Verify Argon2id KDF, AES-256-GCM encryption, and RSA-OAEP key wrapping remain 100% functional | M5 | ORIGINAL_REQUEST Acceptance Criteria |
| 18 | Regression Test Suite Verification | Verify all 54 existing tests in `npm test` pass with 0 failures | M5 | ORIGINAL_REQUEST Acceptance Criteria |
| 19 | Client Build Verification | Verify `npm --prefix src/client run build` produces 0 build errors | M5 | ORIGINAL_REQUEST Acceptance Criteria |
| 20 | Adversarial & Visual Acceptance Audit | Forensic audit verifying zero cheating, zero mock fallbacks, and complete UI/UX fidelity | M5 | ORIGINAL_REQUEST Acceptance Criteria |

*Cross-Check*: Every feature (1 through 20) is assigned to a specific milestone. No feature is left unassigned.

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Design System & Token Foundation | HSL tokens in `src/index.css`, Tailwind config, core UI primitives (`Button`, `Card`, `Badge`, `Input`, `Dialog`, `Sheet`, `DropdownMenu`, `Table`, `Slider`) | none | DONE |
| M2 | Navigation & App Shell Overhaul | `Sidebar.jsx`, `AppHeader.jsx`, `CommandPalette.jsx`, `App.jsx` integration, keyboard shortcuts (`Cmd+K`, `Cmd+B`), lock indicator, notification bell, user dropdown | M1 | DONE |
| M3 | Vault Dashboard & Item Interactions | Modern `VaultDashboard.jsx`, Table & Card Grid views, category badges, favorite stars, contextual dropdown actions, auto-clearing clipboard toast | M1, M2 | DONE |
| M4 | Accessible Modals & Embedded Generator | Viewport-bounded `ItemModal.jsx`, `ShareModal.jsx`, `HistoryDrawer.jsx`, `SecurityNotificationModal.jsx`, embedded compact slider & Diceware generator, `z-[60]` hierarchy | M1, M2, M3 | DONE |
| M5 | Final Acceptance, Zero-Knowledge Verification & Audit | All 54 tests pass (`npm test`), Vite client build passes (`npm --prefix src/client run build`), ZK crypto integrity verified, Forensic Audit CLEAN | M1, M2, M3, M4 | IN_PROGRESS |

---

## Interface Contracts & Component Architecture

### 1. Z-Index Layer Hierarchy
- `z-0` - `z-10`: Background, main content canvas, table/card elements.
- `z-40`: Sticky Header (`AppHeader.jsx`) and mobile sidebar backdrop.
- `z-50`: Dropdown menus, tooltips, popovers, select dropdowns.
- `z-[60]`: Modal dialogs (`ItemModal`, `ShareModal`, `SecurityNotificationModal`) and slide-over drawers (`HistoryDrawer`, mobile navigation sheet).
- `z-[70]`: Modal-internal popovers, date pickers, or nested confirmation dialogs.
- `z-[100]`: Toast notification container (`Toast.jsx` / Sonner).

### 2. Design Tokens (`src/client/src/index.css`)
```css
:root {
  --background: 0 0% 100%;
  --foreground: 240 10% 3.9%;
  --card: 0 0% 100%;
  --card-foreground: 240 10% 3.9%;
  --popover: 0 0% 100%;
  --popover-foreground: 240 10% 3.9%;
  --primary: 240 5.9% 10%;
  --primary-foreground: 0 0% 98%;
  --secondary: 240 4.8% 95.9%;
  --secondary-foreground: 240 5.9% 10%;
  --muted: 240 4.8% 95.9%;
  --muted-foreground: 240 3.8% 46.1%;
  --accent: 240 4.8% 95.9%;
  --accent-foreground: 240 5.9% 10%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 0 0% 98%;
  --border: 240 5.9% 90%;
  --input: 240 5.9% 90%;
  --ring: 240 5.9% 10%;
  --radius: 0.5rem;
  --sidebar-background: 0 0% 98%;
  --sidebar-foreground: 240 5.3% 26.1%;
  --sidebar-primary: 240 5.9% 10%;
  --sidebar-primary-foreground: 0 0% 98%;
  --sidebar-accent: 240 4.8% 95.9%;
  --sidebar-accent-foreground: 240 5.9% 10%;
  --sidebar-border: 220 13% 91%;
  --sidebar-ring: 217.2 91.2% 59.8%;
}

.dark {
  --background: 240 10% 3.9%;
  --foreground: 0 0% 98%;
  --card: 240 10% 4.8%;
  --card-foreground: 0 0% 98%;
  --popover: 240 10% 4.8%;
  --popover-foreground: 0 0% 98%;
  --primary: 0 0% 98%;
  --primary-foreground: 240 5.9% 10%;
  --secondary: 240 3.7% 15.9%;
  --secondary-foreground: 0 0% 98%;
  --muted: 240 3.7% 15.9%;
  --muted-foreground: 240 5% 64.9%;
  --accent: 240 3.7% 15.9%;
  --accent-foreground: 0 0% 98%;
  --destructive: 0 62.8% 30.6%;
  --destructive-foreground: 0 0% 98%;
  --border: 240 3.7% 15.9%;
  --input: 240 3.7% 15.9%;
  --ring: 240 4.9% 83.9%;
  --sidebar-background: 240 5.9% 10%;
  --sidebar-foreground: 240 4.8% 95.9%;
  --sidebar-primary: 224.3 76.3% 48%;
  --sidebar-primary-foreground: 0 0% 100%;
  --sidebar-accent: 240 3.7% 15.9%;
  --sidebar-accent-foreground: 240 4.8% 95.9%;
  --sidebar-border: 240 3.7% 15.9%;
  --sidebar-ring: 217.2 91.2% 59.8%;
}
```

### 3. Modal Viewport Bounds Contract
Every modal dialog (`ItemModal`, `ShareModal`, `SecurityNotificationModal`) must implement:
- Outer wrapper: `fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6 bg-background/80 backdrop-blur-sm animate-content-show`
- Modal container: `relative w-full max-w-lg md:max-w-xl max-h-[85vh] flex flex-col bg-card text-card-foreground border border-border rounded-xl shadow-2xl overflow-hidden`
- Modal header: `flex-shrink-0 px-6 py-4 border-b border-border flex items-center justify-between`
- Modal scrollable body: `flex-1 overflow-y-auto px-6 py-4 space-y-4`
- Modal footer: `flex-shrink-0 px-6 py-4 border-t border-border bg-muted/30 flex justify-end gap-3`

---

## Code Layout
- `src/client/tailwind.config.js`: Tailwind configuration with solid-ui tokens, border radii, animations.
- `src/client/src/index.css`: HSL CSS variable definitions, base styling, scrollbar utilities.
- `src/client/src/components/ui/`: Modern UI primitives (`Button.jsx`, `Card.jsx`, `Badge.jsx`, `Input.jsx`, `Dialog.jsx`, `Sheet.jsx`, `DropdownMenu.jsx`, `Table.jsx`, `Slider.jsx`, `Avatar.jsx`, `Tooltip.jsx`).
- `src/client/src/components/Layout/`:
  - `Sidebar.jsx`: Collapsible left rail/sidebar navigation with keyboard shortcut `Cmd+B`.
  - `AppHeader.jsx`: Sticky top bar (`z-40`) with `Cmd+K` search button, lock status, notification bell, user avatar dropdown.
  - `CommandPalette.jsx`: Quick search modal overlay (`Cmd+K`).
- `src/client/src/components/Vault/`:
  - `VaultDashboard.jsx`: Modern card and table view, category badges, favorite stars, contextual dropdown actions, auto-clearing toast.
  - `ItemModal.jsx`: Bounded viewport `max-h-[85vh]`, collection selector, embedded password generator.
  - `ShareModal.jsx`: Bounded viewport `max-h-[85vh]`, RSA-OAEP key wrapping.
  - `HistoryDrawer.jsx`: Slide-over `Sheet`, version history with client decryption.
- `src/client/src/components/Common/`:
  - `PasswordGenerator.jsx`: Upgraded slider, Diceware selector, CSPRNG rejection sampling.
  - `Toast.jsx`: Upgraded toast container at `z-[100]`.
- `src/client/src/components/SecurityNotificationModal.jsx`: Upgraded Dialog at `z-[60]`.
- `src/client/src/services/crypto.js` & `api.js`: Unaltered cryptographic and API service contracts.
