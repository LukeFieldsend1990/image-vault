# Brand Refresh Spec — "The Gate, Not the Safe"

**Status:** First pass implemented on this branch (`claude/brand-guidelines-spec-5yx2kv`) for side-by-side review.
**Source:** `ImageVault — Brand Guidelines v1.0` (June 2026) + `Brand in Practice` (partner deck)
**Goal:** Migrate the live site from the current "United Agents" black/white/red theme to the new ImageVault editorial brand system, on a dev branch we can run and compare side-by-side before merging.

### Implementation status (this branch)

Done and building (`npm run build` ✓, `tsc` ✓, `lint` ✓ on changed files):
- ✅ **Tokens** — `app/globals.css` `:root` rewritten to the brand palette (warm paper/ink, brick `#BC3D2C`, slate, lifecycle states), `14px`/`8px` radius, serif-heading + `::selection` base styles.
- ✅ **Fonts** — Newsreader + Hanken Grotesk + JetBrains Mono wired in `app/layout.tsx`; `h1–h4` now serif globally.
- ✅ **Wordmark + gate** — new `app/components/wordmark.tsx` (`display` / `lock` variants, brick gate posts, misuse-proof). Swapped into the vault sidebar, mobile bar, and marketing header/footer.
- ✅ **Status badges** — new `app/components/status-badge.tsx` (active / expiring / revoked / purged / neutral), ready to replace inline state pills.
- ✅ **Sidebar — option B (light "paper" rail)** chosen and built: paper background, hairline border-right, ink/slate text, brick-tint active item with brick left-rule. `nav.tsx`, `sidebar-shell.tsx`, `user-widget.tsx` converted from the old dark theme.
- ✅ **Marketing hero** — eyebrows moved from red → slate; hero reframed to "Governance, not storage." with brand-safe, mechanism-accurate copy.

Deliberately deferred (fast-follow, noted for the morning):
- ⏳ **Hardcoded-red sweep** — ~51 UI files still use literal `#c0392b` / `rgba(192,57,43,…)`. These render near-identically to the new brick `#BC3D2C` (192,57,43 vs 188,61,44), so nothing looks broken; a mechanical pass to `var(--color-accent)` / tints is a clean follow-up, not blocking.
- ⏳ **Broader copy pass** — only the marketing hero was reworded; deeper voice alignment (pillars, auth pages) left for review.
- ⏳ **Status-badge adoption** — component exists; wiring it into the ~18 licence/vault/bridge state pills is the next step.

---

---

## 1. TL;DR — what changes

| Area | Today | New brand | Size of change |
|------|-------|-----------|----------------|
| **Accent red** | `#c0392b` | **Brick red `#BC3D2C`** (+ deep `#97301F`, tint `#F2E0DA`) | Token swap — low effort, wide reach |
| **Type system** | Inter only (sans) | **Newsreader** (serif, headlines) + **Hanken Grotesk** (sans, body/labels) + **JetBrains Mono** (data) | New fonts + heading restyle — medium |
| **Text colour** | Pure black `#111` / grey `#777` | Warm **ink** ramp: `#2D2B26` / `#56524A` / `#807B70` | Token swap — low |
| **Surfaces** | White `#fff` / `#f7f7f7`, hairline `#e5e5e5` | Warm **paper**: `#FFFFFF` / `#F5F5F3`, hairline `#E6E5E1` | Token swap — low |
| **Corner radius** | `2px` (sharp) | **`14px`** (soft, editorial) — UI chrome `8px` | Token swap — low, but visually large |
| **Sidebar** | Dark `#0a0a0a`, white text | **Decision needed** — brand is all-paper/light (see §6) | Medium/High |
| **Wordmark** | Plain text "Image Vault" | **ImageVault** camel-case + the **gate** device (two brick posts) | New component — medium |
| **Status colours** | Single red for danger | **Active** olive `#6E7A4F` · **Expiring** ochre `#C0883B` · **Revoked** brick `#BC3D2C` | New tokens + badge component — medium |
| **Voice / copy** | "Your likeness. Your terms." | "Governance, not storage." / "The gate, not the safe." — plain, precise, calm | Copy pass — medium |

**The good news:** the codebase is already cleanly tokenised. `app/globals.css` holds every theme colour as a CSS variable, and **111 files** consume `var(--color-accent)` / `var(--color-*)` rather than hard-coding hex. ~80% of the colour + radius refresh is a single edit to `globals.css`. The bigger lifts are fonts, the wordmark/gate, status badges, the sidebar decision, and copy.

---

## 2. Design tokens — the core change (`app/globals.css`)

The brand guidelines define a token set we map onto the existing `--color-*` names so all 111 consumers update for free, **plus** new semantic tokens for type ramp and status.

### 2.1 Proposed `:root` (replaces lines 6–24 of `globals.css`)

```css
:root {
  /* ── Paper (surfaces) ── */
  --color-bg:        #ffffff;   /* paper      — page background        */
  --color-surface:   #f5f5f3;   /* paper-2    — cards, panels, insets  */
  --color-inset:     #ffffff;   /* paper-3    — inputs / inset white   */
  --color-border:    #e6e5e1;   /* line       — hairlines, borders     */

  /* ── Ink (text ramp) ── */
  --color-ink:       #2d2b26;   /* ink-900    — headlines, wordmark    */
  --color-text:      #56524a;   /* ink-700    — body copy              */
  --color-muted:     #807b70;   /* ink-500    — secondary text         */
  --color-faint:     #b0aa9c;   /* ink-300    — faint / disabled       */

  /* ── Brick red (the single accent) ── */
  --color-accent:       #bc3d2c;  /* brick — figures, rules, emphasis */
  --color-accent-hover: #97301f;  /* red-deep — pressed / hover       */
  --color-accent-tint:  #f2e0da;  /* red-tint — badge backgrounds     */

  /* ── Slate (functional labels / eyebrows) ── */
  --color-slate:     #5e6970;

  /* ── Access lifecycle states ── */
  --color-active:    #6e7a4f;   /* olive  — consent live / licence in force */
  --color-expiring:  #c0883b;   /* ochre  — approaching expiry              */
  --color-revoked:   #bc3d2c;   /* brick  — access closed / purge enforced  */
  --color-danger:    #bc3d2c;

  /* ── Sidebar — see §6 decision ── */
  --color-sidebar:       #0a0a0a;            /* (option A keeps dark)   */
  --color-sidebar-fg:    #ffffff;
  --color-sidebar-muted: rgba(255,255,255,0.45);

  /* ── Type ── */
  --font-serif: "Newsreader", Georgia, "Times New Roman", serif;
  --font-sans:  "Hanken Grotesk", "Helvetica Neue", Helvetica, Arial, sans-serif;
  --font-mono:  "JetBrains Mono", "SFMono-Regular", ui-monospace, Menlo, monospace;

  /* ── Radius ── */
  --radius:    14px;   /* cards, surfaces, primary buttons */
  --radius-md: 8px;    /* UI chrome, inputs, small controls */
  --radius-sm: 6px;
}
```

**Notes**
- Existing names (`--color-bg/surface/border/text/muted/ink/accent/accent-hover/danger`) are preserved, so every current consumer keeps working with new values.
- New names (`--color-inset/faint/slate/accent-tint/active/expiring/revoked`, `--font-serif/mono`, `--radius-md/sm`) are additive.
- `::selection` should become brick-on-paper to match the guideline.

### 2.2 Usage balance (guardrail for review)

The guidelines specify roughly **Paper 80 / Ink 14 / Red 6**. Brick red is a highlighter — figures, rules, live/critical states — *never* decoration. During the dev build we should audit for over-use of accent (current marketing uses red section eyebrows; brand wants **slate** for tracked labels, red reserved for emphasis).

---

## 3. Typography

### 3.1 Fonts

Replace the single Inter import in `app/layout.tsx` with three Google fonts via `next/font`:

```ts
import { Newsreader, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";

const serif = Newsreader({ subsets: ["latin"], weight: ["400","500","600","700"],
  style: ["normal","italic"], variable: "--font-serif", display: "swap" });
const sans  = Hanken_Grotesk({ subsets: ["latin"], weight: ["400","500","600","700"],
  variable: "--font-sans", display: "swap" });
const mono  = JetBrains_Mono({ subsets: ["latin"], weight: ["400","500"],
  variable: "--font-mono", display: "swap" });
// <html className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
```

`globals.css` already maps `--font-sans` into `@theme inline`; add `--font-serif`/`--font-mono` alongside it, and set headings to serif globally:

```css
h1, h2, h3, h4 {
  font-family: var(--font-serif);
  color: var(--color-ink);
  font-weight: 600;
  letter-spacing: -0.01em;
}
```

### 3.2 Type roles (from the guidelines specimen)

| Role | Font / style | Where |
|------|--------------|-------|
| Display / headline | Newsreader 600, `-0.01em` | Page titles, hero, section titles |
| Lede | Newsreader 400 *italic* | Intro sentences, statements |
| Body | Hanken Grotesk 400, `#56524a` | Paragraph copy |
| Label / eyebrow | Hanken Grotesk 600, `0.16em`, uppercase, **slate** | Section labels (current `text-xs tracking-widest uppercase`) |
| Data | Hanken/JetBrains, `tabular-nums` | Licence IDs, dates, amounts, money |

The existing section-header convention (`text-xs font-medium tracking-widest uppercase` with `--color-muted`) stays structurally — we just point its colour at **slate** and bump to weight 600. Serif on headings is the single most visible change; worth a careful visual pass on dense admin tables so they don't feel "magazine-y."

---

## 4. The wordmark + the gate

The brand's one piece of iconography is **the gate**: two equal-weight brick-red posts separating `Image` from `Vault`, with the letters in ink. There is no separate logo icon — the name is the identity.

**Build a `<Wordmark>` component** (`app/components/wordmark.tsx`) with two variants:

- **`display`** — Newsreader, `Image▕▕Vault`, gate posts rendered as two thin brick bars (the guideline draws them via inset linear-gradients; we can do two `1px`–`2px` `<span>`s or a small inline SVG). For hero, cover, footer.
- **`lock`** — tracked sans caps `IMAGE ‖ VAULT`, `0.30em`, ink, with the gate posts between the words. For sidebar, nav chrome, mobile top bar, headers/footers.

Misuse rules to bake into the component (so it can't be set by hand): never stretch, recolour the gate, add shadows, rotate, close the gap, or change weight.

**Replace** the plain "Image Vault" text in: `app/(vault)/nav.tsx`, `app/(vault)/sidebar-shell.tsx` (mobile bar), `app/(vault)/user-widget.tsx`, `app/(marketing)/layout.tsx` (header + footer), and the auth pages.

---

## 5. Status badges (access lifecycle)

The "In practice" demo standardises badges that map directly onto our domain (consent / licence / download token lifecycle). Add a `<StatusBadge>` component:

| State | Token | Label example | Maps to |
|-------|-------|---------------|---------|
| Active | `--color-active` (olive) | `Active` / `Bound` | consent live, licence in force |
| Expiring | `--color-expiring` (ochre) | `Expiring soon` | licence approaching end date |
| Revoked | `--color-revoked` (brick) | `Revoked` | access closed |
| Purged | brick on tint | `Purged · proof archived` | data destroyed post-expiry |

Badge style: tint background (`--color-accent-tint` for brick states; analogous tints for olive/ochre), small caps, `--radius-sm`. This replaces the current ad-hoc inline-styled status pills scattered across licence/vault/bridge clients (≈18 client files reference `--color-accent` for state colour today).

---

## 6. Open decision — the sidebar

This is the one place the brand and the current app genuinely diverge, and it drives the whole "feel."

- **Today:** dark sidebar (`#0a0a0a`), white text — a strong, recognisable element.
- **Brand guidelines:** an all-**paper** system. The reference UI ("In practice") uses a light surface with a hairline `border-right` and ink/slate text. There is no dark chrome anywhere in the deck.

**Options:**
- **A — Keep dark sidebar** (lowest risk). Refresh only its accents (brick active-state, serif wordmark). Fast, but slightly off-brand vs. the deck.
- **B — Light "paper" sidebar** (truest to brand). `--color-surface` background, `border-right: 1px solid --color-border`, ink text, slate labels, brick active indicator. Bigger visual change; needs an active-item treatment (e.g. brick left-rule + ink text) and a contrast pass.
- **C — Hybrid:** paper sidebar on marketing/auth, keep dark in the authenticated vault for focus.

**Recommendation: B**, since the entire brand rests on the warm-paper editorial feel and a dark rail fights it — but this is exactly the kind of thing the dev branch exists to compare. Flagging for your call before I build it.

---

## 7. Voice & tone (copy pass)

The brand voice is **plain, precise, accountable, calm** — and explicitly *never* trades on fear or "bank-grade/military-strength/unbreakable" language. This aligns with `CLAUDE.md`'s standing rule against "zero-knowledge / end-to-end / unbreakable" claims, so it's reinforcing, not conflicting.

Suggested headline shifts (marketing + auth):
- Hero: "Your likeness. Your terms." → consider **"Governance, not storage."** with lede *"The gate every party passes through to use a performer's likeness — consented, audited, and time-bound."*
- Lean on the four pillars as feature sections: consent bound to the scan · access is a gate not a copy · every touch on the record · licence expires, data purged.
- Replace any "encrypted / secure middle ground" phrasing with precise mechanism language ("time-limited, fully audited access through a secure proxy that leaves no copy behind").

Copy is lower-risk to stage incrementally and worth a dedicated review — listed here for completeness, not necessarily in the first visual cut.

---

## 8. Rollout plan (dev branch)

Phased so each step is reviewable and independently revertible:

1. **Tokens** — rewrite `:root` in `globals.css` (§2). Instantly recolours the whole app via existing variables. *(low effort, high visual payoff)*
2. **Fonts** — wire Newsreader + Hanken + JetBrains in `layout.tsx`, serif headings in `globals.css` (§3).
3. **Radius** — `2px → 14px` lands automatically with the token; visual sweep of buttons/inputs/cards for anything that hard-codes `rounded`/`rounded-sm`.
4. **Wordmark + gate** component, swapped into nav/header/footer/auth (§4).
5. **Status badges** component + replace inline state pills (§5).
6. **Sidebar** — implement the §6 decision once made.
7. **Copy pass** — marketing + auth voice alignment (§7).
8. **Audit** — accent over-use sweep against the 80/14/6 balance; contrast/accessibility check on new ink-on-paper and status colours.

**Suggested first commit for comparison:** steps 1–3 only. That's the dramatic before/after (warm paper, brick red, serif headlines, soft corners) with minimal structural risk — enough to judge the direction before investing in the wordmark, badges, and sidebar.

## 9. Effort / risk summary

| Phase | Effort | Risk | Notes |
|-------|--------|------|-------|
| Tokens + radius | S | Low | One file; reversible |
| Fonts + serif headings | S–M | Low | Watch dense tables |
| Wordmark / gate | M | Low | New isolated component |
| Status badges | M | Med | Touches ~18 client files |
| Sidebar (option B) | M–L | Med | Contrast + active-state design |
| Copy pass | M | Low | Stage independently |

No backend, schema, or API changes — this is purely the presentation layer (`globals.css`, `layout.tsx`, shared components, and per-page styling). Per-agency themes in `themes/` (if/when populated) would inherit the same token contract.

---

### Appendix A — token name crosswalk

| Brand guideline var | Hex | This spec's `--color-*` |
|---------------------|-----|--------------------------|
| `--paper` | `#FFFFFF` | `--color-bg` |
| `--paper-2` | `#F5F5F3` | `--color-surface` |
| `--paper-3` | `#FFFFFF` | `--color-inset` |
| `--line` | `#E6E5E1` | `--color-border` |
| `--ink-900` | `#2D2B26` | `--color-ink` |
| `--ink-700` | `#56524A` | `--color-text` |
| `--ink-500` | `#807B70` | `--color-muted` |
| `--ink-300` | `#B0AA9C` | `--color-faint` |
| `--red` | `#BC3D2C` | `--color-accent` |
| `--red-deep` | `#97301F` | `--color-accent-hover` |
| `--red-tint` | `#F2E0DA` | `--color-accent-tint` |
| `--slate` | `#5E6970` | `--color-slate` |
| `--active` | `#6E7A4F` | `--color-active` |
| `--expiring` | `#C0883B` | `--color-expiring` |
| `--revoked` | `#BC3D2C` | `--color-revoked` |
