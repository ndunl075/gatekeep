# Design

gatekeep copies the look of the DuggAI product (duggai.com). Every screen should feel like a Dugg screenshot.
Dark only. Quiet, dense, precise. No gradients inside the app, no drop shadows on cards, no emoji.

## The look in one paragraph

A near-black app window (`bg-canvas` #0b0b0d) with a thin title bar: three grey traffic-light dots, the logo,
then small icon + label tabs ("Overview", "Checks" ...). The active tab sits on a `bg-raised` rounded rectangle.
Content is a centered column (~900-980px). Page titles are big and **light weight** (28px, font-light,
tight tracking): "Good evening, Maya", "Usage", "Your map". Under them, panels: `bg-panel` with a 1px `border-line`
and 8px radius. Inside panels, cards: `bg-card`, 1px border, 6px radius. Section labels are tiny uppercase
monospace with wide tracking (`<MonoLabel>`: "WHAT DUGG SEES", "INPUTS", "WORKING NOW"). Numbers are big and light
(26px font-light) with a small muted unit next to them ("231 judged today"). Secondary text is `text-muted`
#8e8ea0 at 11-12px. Segmented controls (Live | Replay | Inputs) top right of a page.

## Reference screens (from duggai.com)

- **Map**: left column of source cards (icon square, title, "Last 6s ago" muted, count right-aligned with a tiny
  unit under it), thin 1px connector lines into a middle column of numbered step cards ("1 Jev checks each change
  / 231 judged today / 14 woke a goal · 0 waiting"), then a right column of goal cards. A side panel on the right
  holds a one-line status sentence and MonoLabel sections. Above it all, one plain sentence summary:
  "Today Dugg read 1,284 screens, 42 emails ... 3 decisions wait for you."
  → gatekeep Overview mirrors this: a summary sentence, a pipeline of Inputs → Checks → Decisions, and stat cards.
- **Usage**: page title + one-line subtitle, segmented control right. Stacked panels, each with a header row
  (icon square, title, muted subtitle, right-side control like "4.0M a day ⌄"), then content: a thin progress
  bar; ring gauges with "58% left"; and a **14-day stacked bar chart** with rounded bar tops, legend dots top
  right (Claude peach, Codex teal, Grok grey), single-letter weekday labels under the bars.
  → gatekeep Overview uses the same stacked bars for allow / challenge / block per day, and Billing uses the
  progress bar + ring for quota.
- **Decisions**: stacked collapsible rows (icon, title, right-aligned muted type + chevron). The open item is a
  card with a bold title, a To/From/Subject key-value block in muted labels, body text, and an action row at the
  bottom: an input "Ask about this..." on the left, `secondary` "Dismiss" and `primary` (white) "Send email".
  "2 of 3" pager below with up/down chevrons.
  → gatekeep Check detail uses this layout: email as title, Key/Value block (IP, user agent, device, score),
  signals list, actions.
- **Landing page**: full-bleed twilight sky (`.sky .sky-noise`), header with logo left and "Sign in" right,
  huge centered light headline (64-80px, font-light), one outlined button with an arrow ("Book a demo →"),
  then a framed product shot (`<AppWindow framed>`, glowing pink-blue 1px border). Further sections alternate a
  big light headline + muted paragraph on one side and a framed product shot on the other. Footer: a black
  rounded panel with a two-line statement, an outlined CTA right, a links row, and a giant wordmark spanning the
  full width ("DUGGAI" in ~200px heavy grey type → "GATEKEEP").

## Tokens (src/app/globals.css)

| Token | Value | Use |
|---|---|---|
| canvas | #0b0b0d | window body |
| chrome | #0f0f11 | title bar |
| panel | #141416 | panels |
| card | #1a1a1d | cards in panels |
| raised | #232327 | active tab, hovers |
| line / line-2 | #26262b / #34343a | borders / input borders |
| ink / ink-2 / muted / faint | #fff / #c9c9d1 / #8e8ea0 / #5f5f6b | text |
| allow / challenge / block | #3ecf9e / #f0b86e / #f07a7a | decision colors, chart series |
| peach / sky / violet | #e8a383 / #8fa8ff / #b49cff | accents |

Fonts: Inter (sans), Geist Mono (labels, code, numbers in tables). Buttons: 32px tall, 5px radius.
Primary = white with black text. Secondary = #1c1c1f with `line-2` border.

## Primitives (use these, do not restyle ad hoc)

`src/components/ui/index.tsx`: `Logo`, `MonoLabel`, `Panel`, `PanelHeader`, `Card`, `PageTitle`, `Button`,
`ButtonLink`, `buttonClass`, `Segmented`, `DecisionBadge`, `StatCard`, `Input`, `Code`, `Kbd`, `cx`.
`src/components/ui/app-window.tsx`: `AppWindow`, `AppContent`, `APP_TABS`.

Copy voice: short, plain, concrete numbers. "Blocked 214 throwaway signups this week." No hype words.
