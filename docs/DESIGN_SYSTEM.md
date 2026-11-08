# Design System — Salary Desk

This document records the visual system in the Salary Desk sidebar reference,
`salary_desk_with_sidebar.html`. That file is a design prototype with selectable
styles, palettes, and motion settings. It is a design reference, not proof that
every option is implemented in the production application. Production screens
should follow the shared layout, typography, and interaction principles below
without implying that prototype-only controls or effects are available.

## Design principles

- **Clear and dependable:** make payroll and employee information easy to scan.
- **Structured navigation:** persistent sidebar navigation on desktop; an
  off-canvas sidebar on narrow screens.
- **Consistent surfaces:** use the selected palette for page, card, border, and
  text colors; avoid unintended transparent surfaces.
- **Calm interaction:** motion supports state and affordance, without obscuring
  data or preventing access to controls.
- **Responsive by intent:** preserve access to navigation and content at every
  viewport width.

## Typography

| Purpose | Reference font stack |
|---------|----------------------|
| Body and UI | `"Manrope", system-ui, sans-serif` |
| Headings | `"Space Grotesk", system-ui, sans-serif` |
| Serif display option | `"Playfair Display", Georgia, serif` |
| Monospaced option | `"JetBrains Mono", monospace` |

The default body line-height is `1.6`. The reference display heading uses
`clamp(2.4rem, 5.5vw, 4.2rem)` with a `1.08` line-height. The lead paragraph is
`1.15rem`, with a maximum line length of `50ch`. Use the sans stack for normal
application UI; serif and monospace are theme-specific variations.

## Layout and responsive behavior

| Parameter | Reference value |
|-----------|-----------------|
| Desktop sidebar width | `260px` |
| Sidebar placement | Fixed, full viewport height, left edge |
| Main content offset | Sidebar width; full width when sidebar is closed on mobile |
| Sidebar padding | `24px 16px` |
| Sidebar section gap | `20px` |
| Navigation item padding | `10px 14px` |
| Navigation item gap | `12px` |
| Navigation list gap | `8px` |
| Navigation item radius | `10px` |
| Main wrapper maximum width | `1100px` |
| Main wrapper horizontal padding | `24px` |
| Mobile sidebar breakpoint | `900px` |
| Sidebar toggle position | Fixed, `20px` from bottom and right |

At widths of `900px` and below, the sidebar translates off-canvas and opens
with the `open` state; main content loses its left offset and fills the
viewport. The sidebar toggle becomes visible. The style-control bar is centered
at this breakpoint and constrained to `98vw`.

The prototype's example content uses a `1.1fr 0.9fr` hero grid with a `48px`
gap, responsive content cards at `minmax(280px, 1fr)` with a `28px` gap, and a
three-column Bento variant (`1.4fr 1fr 1fr`) with a `20px` gap. These are
example composition values, not requirements for every application page.

## Color system

The reference defines these CSS custom properties:

| Token | Role |
|-------|------|
| `--sidebar-width` | Desktop navigation width (`260px`) |
| `--ease` | Shared easing curve (`cubic-bezier(.2, .7, .2, 1)`) |
| `--motion-mult` | Motion duration/distance multiplier |
| `--bg` | Page background |
| `--card-bg` | Card and raised surface |
| `--ink` | Primary text |
| `--ink-soft` | Secondary text |
| `--border` | Borders and separators |
| `--accent` | Primary accent and selected states |
| `--on-accent` | Text/icon color on accent surfaces |
| `--accent-light`, `--accent-dark` | Accent variants for theme treatments |
| `--accent-secondary` | Second accent, including gradient buttons |
| `--bg-gradient` | Gradient page backgrounds |
| `--shadow-dark`, `--shadow-light` | Neumorphic shadows |
| `--shadow-outer`, `--shadow-inner-1`, `--shadow-inner-2` | Clay/tactile shadows |
| `--glass-bg`, `--glass-border` | Glass surface and edge |
| `--glow` | Accent-colored hover glow |

The palette selector supplies light and dark values for those contextual
tokens. The table below lists each palette's core surface, text, border, and
accent tokens. Hex values are copied from the reference matrix.

| Palette | Mode | `--bg` | `--card-bg` | `--ink` | `--ink-soft` | `--border` | `--accent` | `--on-accent` |
|---------|------|--------|-------------|---------|--------------|------------|------------|---------------|
| Navy | Light | `#f3f5f9` | `#ffffff` | `#0f172a` | `#475569` | `#cbd5e1` | `#f5a524` | `#0f172a` |
| Navy | Dark | `#0b1329` | `#111c38` | `#f8fafc` | `#94a3b8` | `#1e293b` | `#fbbf24` | `#0b1329` |
| Forest | Light | `#f4f7f6` | `#ffffff` | `#064e3b` | `#2d6a4f` | `#d1fae5` | `#f59e0b` | `#ffffff` |
| Forest | Dark | `#03291e` | `#064e3b` | `#f0fdf4` | `#a7f3d0` | `#047857` | `#fbbf24` | `#03291e` |
| Plum | Light | `#f8f6f9` | `#ffffff` | `#3b1848` | `#6b307b` | `#f3e8ff` | `#ff6b6b` | `#ffffff` |
| Plum | Dark | `#1c0a24` | `#3b1848` | `#faf5ff` | `#d8b4fe` | `#581c87` | `#ff6b6b` | `#ffffff` |
| Terracotta | Light | `#f7f4ef` | `#ffffff` | `#7c2d12` | `#9a3412` | `#ffedd5` | `#10b981` | `#ffffff` |
| Terracotta | Dark | `#2e0f06` | `#541c09` | `#fff7ed` | `#fdba74` | `#7c2d12` | `#34d399` | `#2e0f06` |
| Indigo | Light | `#f1f3fe` | `#ffffff` | `#1e1b4b` | `#3730a3` | `#e0e7ff` | `#f43f5e` | `#ffffff` |
| Indigo | Dark | `#0b092b` | `#1e1b4b` | `#e0e7ff` | `#a5b4fc` | `#312e81` | `#fb7185` | `#0b092b` |
| Ocean | Light | `#edf8f8` | `#ffffff` | `#042f2e` | `#115e59` | `#ccfbf1` | `#ff6b35` | `#ffffff` |
| Ocean | Dark | `#021a19` | `#042f2e` | `#f0fdfa` | `#5eead4` | `#0f766e` | `#ff8c42` | `#021a19` |
| Charcoal | Light | `#f1f5f9` | `#ffffff` | `#1e293b` | `#475569` | `#cbd5e1` | `#84cc16` | `#0f172a` |
| Charcoal | Dark | `#0f172a` | `#1e293b` | `#f8fafc` | `#94a3b8` | `#334155` | `#a3e635` | `#0f172a` |
| Midnight | Light | `#f5f3ff` | `#ffffff` | `#2e1065` | `#5b21b6` | `#ddd6fe` | `#8b5cf6` | `#ffffff` |
| Midnight | Dark | `#13072b` | `#230f4c` | `#f5f3ff` | `#c4b5fd` | `#4c1d95` | `#a78bfa` | `#13072b` |
| Espresso | Light | `#fbf8f5` | `#ffffff` | `#431407` | `#78350f` | `#ffedd5` | `#ea580c` | `#ffffff` |
| Espresso | Dark | `#1f0904` | `#3a1208` | `#fff7ed` | `#ffedd5` | `#7c2d12` | `#f97316` | `#1f0904` |
| Deep Space | Light | `#f0f4f8` | `#ffffff` | `#102a43` | `#334e68` | `#bccadc` | `#f0b429` | `#102a43` |
| Deep Space | Dark | `#081726` | `#102a43` | `#f0f4f8` | `#9fb3c8` | `#243b53` | `#fadb5f` | `#081726` |

Palette-specific gradients, shadow colors, glass colors, accent tints, and glow
colors are part of the same matrix. Keep the corresponding token values from
the reference together when changing a palette; do not assume those values can
be derived from the core colors.

## Spacing, sizing, and layering

The reference does not define a formal numbered spacing scale. Its reusable
measurements are:

| Use | Value |
|-----|-------|
| Tight control gap | `4px` |
| Small row/section gap | `8px` |
| Navigation item gap | `12px` |
| Standard card/grid gap | `28px` |
| Sidebar section gap | `20px` |
| Main content horizontal inset | `24px` |
| Large feature gap | `48px` |
| Badge padding | `4px 12px` |
| Button padding | `13px 28px` |

Reference stacking levels are sidebar `900`, fixed style controls `1000`, and
mobile sidebar toggle `1001`. Decorative background layers use `-2` and `-1`
and do not accept pointer events.

## Selectable reference variants

### UI style (16)

| Category | Styles |
|----------|--------|
| Modern | Minimalism, Glassmorphism, Bento Grid, Flat 2.0, Dark Luxe, Aurora Glass |
| 3D & Tactile | Neumorphism, Claymorphism, Organic Bio, Paper Cutout |
| Expressive | Neo-Brutalism, Motion UI, Skeuomorphism, Cyberpunk, Retrowave, High Contrast |

The prototype starts with **Neumorphism**. `Dark Luxe` uses the `darkmode`
style identifier; `Flat 2.0` uses `flat`; `Aurora Glass` uses `aurora`; `Paper
Cutout` uses `papercut`.

### Background motion (6)

`Floating Orbs` (default), `Kinetic Mesh`, `Aurora Waves`, `Cyber Scanline`,
`Interactive Particles`, and `None (Static)`.

### Hover motion (10)

`Spring` (default), `Magnetic`, `Snap`, `Glide`, `Clay Pop`, `Glow`, `Strobe`
(identifier `cyber`), `Rubber`, `Shimmer`, and `Kinetic`.

### Other configurable parameters

| Setting | Options | Default |
|---------|---------|---------|
| Motion intensity | Off (`0`), Subtle (`0.5x`), Normal (`1x`), Intense (`2x`) | Normal |
| Scroll reveal direction | Up, Down, Left, Right, Zoom | Up |
| Corners | Default, Sharp (`0px`), Round (`12px` cards / `8px` buttons), Pill (`36px` cards / `999px` buttons and badges) | Default |
| Surface | Default, Flat (no shadow), Outlined (`2px` border), Deep 3D (`0 20px 40px` shadow) | Default |
| Color mode | Light, Dark | Light |
| Palette | Navy, Forest, Plum, Terracotta, Indigo, Ocean, Charcoal, Midnight, Espresso, Deep Space | Navy |

The category filter controls which style choices are shown; it does not change
the palette, motion, or surface settings.

### Style-specific shape and surface examples

| Style | Defining treatment in the reference |
|-------|-------------------------------------|
| Neumorphism | Background-matched raised surfaces; paired `8px 8px 16px` shadows; `24px` raised corners |
| Minimalism | Divider-like surfaces, no shadow, square corners |
| Glassmorphism | Glass token surfaces, `16px` blur, `24px` corners |
| Bento Grid | `28px` raised/payslip corners; `24px` cards; `1.4fr 1fr 1fr` layout |
| Neo-Brutalism | `4px` ink borders, square corners, `6px` hard shadow |
| Claymorphism | `36px` corners, layered outer and inset shadows |
| Flat 2.0 | `12px` surfaces, subtle `0 2px 8px` shadow, `8px` buttons |
| Dark Luxe | `20px` corners, `0 10px 30px` shadow |
| Motion UI | `24px` corners, accent gradient primary button, pill badge |
| Skeuomorphism | Serif font, beveled gradients, inset and drop shadows |
| Cyberpunk | Monospace, neon borders/glows, square controls |
| Retrowave | Purple gradient, neon pink/cyan accents and glow |
| Aurora Glass | Deep gradient, translucent surfaces, `24px` blur, `30px` corners |
| Organic Bio | Warm colors, asymmetric `40px 15px` corners |
| High Contrast | Black/white/yellow, `3px` borders, square surfaces, no shadow |
| Paper Cutout | White surfaces, `16px` corners and hard offset shadows |

## Component and visual parameters

| Element | Reference treatment |
|---------|--------------------|
| Sidebar | `--card-bg` surface; right `1px` border; fixed at desktop; `900` stacking order |
| Sidebar logo | `1.2rem`, weight `800` |
| Sidebar navigation | `0.95rem`, weight `600`; active/hover uses `--accent` and `--on-accent` |
| Main wrapper | `1100px` maximum width, centered, `24px` horizontal padding |
| Primary buttons | Inline-flex centered; `13px 28px` padding; `0.95rem`; weight `700` |
| Status badge | `4px 12px` padding; `0.8rem`; weight `700`; pill radius by default |
| Cards | Example content uses `28px` padding |
| Payslip panel | Example content uses `28px` padding |
| Grid | Example content uses `28px` gap and `minmax(280px, 1fr)` columns |
| Hero | `40px 0 60px` padding |
| Footer | `40px 24px 120px` padding; `0.9rem` |

The active visual style may replace the default corner, border, background,
shadow, and button treatments. For example, Minimalism removes card shadows and
uses divider-like surfaces; Glassmorphism uses a `16px` backdrop blur; and
Neo-Brutalism uses a `4px` ink border with a `6px` hard shadow.

## Motion and timing

| Token or behavior | Reference value |
|-------------------|-----------------|
| Default easing token | `cubic-bezier(.2, .7, .2, 1)` |
| Default motion multiplier | `1` |
| Sidebar/layout transitions | `0.3s` using the default easing token |
| Body background/color transition | `0.25s ease` |
| Scroll reveal threshold | `0.15` intersection ratio |
| Scroll reveal distance | `40px` vertical, `50px` horizontal |
| Scroll reveal duration | `0.35s × --motion-mult` |
| Default card hover | `-6px` Y and `2%` scale |
| Default button hover | `-3px` Y and `3%` scale |

Intensity maps to motion multipliers `0`, `0.5`, `1`, and `2`. Off disables
transitions and animations and resets transforms. The reference does not define
a `prefers-reduced-motion` media query; production implementations must honor
that user preference in addition to any in-app motion setting.

## Accessibility and implementation notes

- Keep all navigation, buttons, and controls keyboard reachable with a visible
  focus state; do not rely on color alone to convey selection or status.
- Preserve legible text contrast for every light/dark palette combination.
- Provide accessible names for icon-only controls and appropriate live-region
  semantics for dynamic feedback.
- Respect `prefers-reduced-motion`; avoid motion that delays or obscures
  payroll data.
- The reference uses decorative background effects behind content and marks
  their layers `pointer-events: none`.
- Palette and style settings in the reference are applied through CSS custom
  properties and body classes/data attributes. Keep a single source of truth
  for those values when implementing them.
- This document describes the local HTML reference. Verify production
  components and tokens in `public/styles.css` and `public/app.js` before
  describing a reference-only option as shipped functionality.
