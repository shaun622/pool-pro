# Modern Service-Business PWA — Design System

A reusable design system for premium, app-like business tools (field service, dispatch, CRM, inventory, trade services). **Crisp white-on-slate** light mode + **full dark mode**, vibrant brand-colour primary driven by CSS variables, generous rounding, soft layered shadows, clean sans-serif with tabular numerals. Mobile-first with native-app feel — bottom tab bar + "More" sheet on phones, sticky two-row top nav on desktop. Built for dispatchers and techs who use it one-handed in the field.

**Stack:** Vite + React 18 + Tailwind CSS 3 + React Router 6. Drop-in compatible with Next.js 14+ (replace Router with Next's App Router).

> **How to use this file:** Paste this whole document as the first message in a new project (or save it as `CLAUDE.md` / load it into Claude Projects knowledge). Tell the assistant:
> *"Use this design system. Brand colour is #XXXXXX (generate 50–950 scale). App is called YYY. Bottom-nav primary tabs are: A, B, C, D. Entity nouns: {pool → window, pools → windows, jobs → installs, clients → customers}."*

> **What's PoolPro-specific vs portable:** The tokens, primitives, layout shell, and page patterns below are portable. Domain modals (AddRecurringModal, StopDetailModal, ChemicalLibrary) are not — replace with your app's equivalents. Badge variants like `chlorine/salt/mineral/freshwater` are pool-type specific — swap for your domain (e.g. `aluminium/timber/upvc/commercial`).

---

## 1. Color system — CSS variables drive everything

The brand colour is NOT hardcoded in Tailwind. It's set via CSS variables on `<html>` and consumed by Tailwind's `rgb(var(--x) / <alpha-value>)` format. This is what makes dark mode, theming, and future rebrands clean.

**`src/styles/index.css`:**

```css
:root {
  /* Brand palette — generate from your hex with e.g. uicolors.app/create, then drop as space-separated RGB triplets */
  --brand-50:  240 250 255;
  --brand-100: 224 244 254;
  --brand-200: 185 232 254;
  --brand-300: 124 215 253;
  --brand-400: 54 193 250;
  --brand-500: 12 165 235;   /* Primary — buttons, active states, links */
  --brand-600: 0 132 201;    /* Hover */
  --brand-700: 0 105 163;
  --brand-800: 4 88 134;
  --brand-900: 10 74 111;
  --brand-950: 6 47 74;
  --ease-out-expo: cubic-bezier(0.22, 1, 0.36, 1);
}
```

**Values are space-separated RGB triplets.** No commas, no `rgb(...)` wrapper. This is what makes `bg-brand-500/40` (opacity modifier) work.

**Semantic status colours** — use stock Tailwind palettes, **never invent new semantic names**:

| Meaning | Palette | Light surface/text | Dark surface/text |
|---|---|---|---|
| Primary / info | `brand-*` | `bg-brand-50 text-brand-700` | `bg-brand-950/40 text-brand-300` |
| Success | `emerald-*` | `bg-emerald-50 text-emerald-700` | `bg-emerald-950/40 text-emerald-300` |
| Warning | `amber-*` | `bg-amber-50 text-amber-700` | `bg-amber-950/40 text-amber-300` |
| Danger | `red-*` | `bg-red-50 text-red-700` | `bg-red-950/40 text-red-300` |
| Neutral | `gray-*` | `bg-gray-100 text-gray-600` | `bg-gray-800 text-gray-300` |

**Rules**
- App background: `bg-slate-50` (light), `bg-gray-950` (dark) — **never plain white**
- Cards: `bg-white` over slate / `bg-gray-900` over black — contrast matters
- Primary actions: `bg-gradient-brand` (500 → 700), **never flat brand color**
- No raw black or pure white. `text-gray-900` / `dark:text-gray-100` is deepest.

---

## 2. Dark mode — first-class

**Tailwind config:** `darkMode: 'class'`. Target: `<html>` via `document.documentElement.classList.add('dark')`. Three modes: `light` / `system` / `dark`. Default `system`. Persisted in `localStorage` under a per-app key (e.g. `'windowpro:theme-mode'`).

### FOUC prevention — inline script in `index.html` `<head>` BEFORE any stylesheet:

```html
<script>
  (function () {
    try {
      var t = localStorage.getItem('appname:theme-mode') || 'system';
      var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (t === 'dark' || (t === 'system' && prefersDark)) {
        document.documentElement.classList.add('dark');
      }
    } catch (e) {}
  })();
</script>
```

**Do not skip this.** A theme flash on every reload is the #1 "cheap app" tell.

### ThemeContext + hooks

```jsx
// src/contexts/ThemeContext.jsx
import { createContext, useContext, useEffect, useState } from 'react'

const ThemeContext = createContext({ mode: 'system', setMode: () => {}, isDark: false })
const STORAGE_KEY = 'appname:theme-mode'

function applyMode(mode) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = mode === 'dark' || (mode === 'system' && prefersDark)
  document.documentElement.classList.toggle('dark', isDark)
  return isDark
}

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || 'system' } catch { return 'system' }
  })
  const [isDark, setIsDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  )
  useEffect(() => {
    setIsDark(applyMode(mode))
    try { localStorage.setItem(STORAGE_KEY, mode) } catch {}
  }, [mode])
  useEffect(() => {
    if (mode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setIsDark(applyMode('system'))
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [mode])
  return <ThemeContext.Provider value={{ mode, setMode: setModeState, isDark }}>{children}</ThemeContext.Provider>
}
export function useTheme() { return useContext(ThemeContext) }
```

Wrap at root: `<BrowserRouter><ThemeProvider><AuthProvider>...</AuthProvider></ThemeProvider></BrowserRouter>`

### Two toggle variants

**Compact toggle (header)** — single-click flip between light ↔ dark. No system cycle (users set `system` in Settings, not from the header).

```jsx
export function ThemeToggleCompact() {
  const { setMode, isDark } = useTheme()
  const Icon = isDark ? Moon : Sun
  return (
    <button onClick={() => setMode(isDark ? 'light' : 'dark')}
      className="min-h-tap min-w-tap rounded-xl p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 transition-colors">
      <Icon className="w-5 h-5" strokeWidth={2} />
    </button>
  )
}
```

**Full toggle (Settings → Appearance)** — three-mode segmented control: Light / System / Dark with Lucide icons. Active button gets `bg-brand-500 text-white shadow-sm`.

---

## 3. Tooling & dependencies

```json
{
  "dependencies": {
    "@fontsource-variable/inter": "^5.x",
    "@fontsource-variable/jetbrains-mono": "^5.x",
    "lucide-react": "^0.468.0",
    "clsx": "^2.x",
    "tailwind-merge": "^2.x"
  }
}
```

- **Inter Variable** body font; **JetBrains Mono Variable** for code/tabular
- **lucide-react** is the ONLY icon library (don't mix Heroicons, Feather, inline SVGs)
- **`cn()` utility** (required):
  ```js
  // src/lib/utils.js
  import { clsx } from 'clsx'
  import { twMerge } from 'tailwind-merge'
  export const cn = (...args) => twMerge(clsx(...args))
  ```
  This is what lets later classes override earlier ones (e.g. `cn('p-4', '!p-0')` → `p-0`).

---

## 4. Tailwind config — extends only

```js
// tailwind.config.js
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)',
          900: 'rgb(var(--brand-900) / <alpha-value>)',
          950: 'rgb(var(--brand-950) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'monospace'],
      },
      spacing: { tap: '44px' },
      minHeight: { tap: '44px' },
      minWidth:  { tap: '44px' },
      boxShadow: {
        card:         '0 1px 3px 0 rgba(0,0,0,0.04), 0 1px 2px -1px rgba(0,0,0,0.03)',
        'card-hover': '0 4px 12px 0 rgba(0,0,0,0.08), 0 2px 4px -2px rgba(0,0,0,0.04)',
        elevated:     '0 8px 24px -4px rgba(0,0,0,0.08), 0 4px 8px -4px rgba(0,0,0,0.04)',
        'soft-lift':  '0 10px 30px -10px rgba(0,0,0,0.12)',
        glow:         '0 0 20px rgb(var(--brand-500) / 0.15)',
        'glow-lg':    '0 0 40px rgb(var(--brand-500) / 0.20)',
        nav:          '0 -1px 12px 0 rgba(0,0,0,0.06)',
        'inner-soft': 'inset 0 2px 4px 0 rgba(0,0,0,0.04)',
      },
      backgroundImage: {
        'gradient-brand':      'linear-gradient(135deg, rgb(var(--brand-500)) 0%, rgb(var(--brand-700)) 100%)',
        'gradient-brand-soft': 'linear-gradient(135deg, rgb(var(--brand-100)) 0%, rgb(var(--brand-50)) 100%)',
        'gradient-success':    'linear-gradient(135deg, #10b981 0%, #059669 100%)',
        'gradient-danger':     'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
      },
      borderRadius: { '2xl': '1rem', '3xl': '1.25rem' },
      animation: {
        'fade-in':  'fadeIn 0.25s ease-out',
        'slide-up': 'slideUp 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
        'scale-in': 'scaleIn 0.18s cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        fadeIn:  { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        slideUp: { '0%': { transform: 'translateY(100%)' }, '100%': { transform: 'translateY(0)' } },
        scaleIn: { '0%': { transform: 'scale(0.95)', opacity: 0 }, '100%': { transform: 'scale(1)', opacity: 1 } },
      },
    },
  },
}
```

---

## 5. Global styles

```css
/* src/styles/index.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

/* CSS variables (see §1) */
:root { /* ... */ }

@layer base {
  html {
    -webkit-tap-highlight-color: transparent;
    transition: background-color 0.35s var(--ease-out-expo), color 0.35s var(--ease-out-expo);
  }
  html * {
    transition-property: background-color, border-color, color, fill, stroke, box-shadow;
    transition-duration: 0.25s;
    transition-timing-function: var(--ease-out-expo);
  }
  @media (prefers-reduced-motion: reduce) {
    html, html * { transition: none !important; animation: none !important; }
  }

  html, body { overscroll-behavior: none; }
  body {
    font-family: 'Inter Variable', system-ui, -apple-system, sans-serif;
    font-feature-settings: 'cv11', 'ss01';
    font-variant-numeric: tabular-nums;   /* makes numbers align everywhere */
    -webkit-font-smoothing: antialiased;
    @apply bg-slate-50 text-gray-900;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  .dark body { @apply bg-gray-950 text-gray-100; }
  ::selection { @apply bg-brand-200 text-brand-900; }
  .dark ::selection { @apply bg-brand-800 text-brand-100; }
}

@layer components {
  .section-title { @apply text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400; }

  .btn { @apply inline-flex items-center justify-center rounded-xl font-semibold transition-all duration-200 min-h-tap min-w-tap px-5 py-3 text-sm tracking-wide focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-2 dark:focus:ring-offset-gray-950 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]; }
  .btn-primary   { @apply btn bg-gradient-brand text-white shadow-md shadow-brand-500/20 hover:shadow-lg hover:brightness-110; }
  .btn-secondary { @apply btn bg-white text-gray-700 border border-gray-200 shadow-card hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-800; }
  .btn-danger    { @apply btn bg-gradient-danger text-white shadow-md shadow-red-500/20 hover:brightness-110; }

  .input { @apply w-full rounded-xl border border-gray-200 bg-white px-4 py-3 min-h-tap shadow-inner-soft placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 dark:bg-gray-900 dark:border-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500; font-size: 16px; /* STOP iOS zoom */ }

  .card { @apply bg-white rounded-2xl border border-gray-100 p-4 shadow-card transition-all duration-200 dark:bg-gray-900 dark:border-gray-800; }
  .card-interactive { @apply card cursor-pointer hover:shadow-card-hover hover:border-gray-200 hover:-translate-y-0.5 active:translate-y-0 dark:hover:border-gray-700; }

  .scrollbar-none::-webkit-scrollbar { display: none; }
  .scrollbar-none { scrollbar-width: none; -ms-overflow-style: none; }
}
```

---

## 6. Typography scale

| Use | Class | Size | Weight |
|---|---|---|---|
| Page H1 | `text-2xl sm:text-3xl font-bold tracking-tight` | 24/30 | 700 |
| Page subtitle | `text-sm text-gray-500 dark:text-gray-400` | 14 | 400 |
| Card heading | `font-semibold text-gray-900 dark:text-gray-100` | 16 | 600 |
| Body / input | (default) | 16 | 400 |
| Form label | `text-sm font-medium text-gray-600 dark:text-gray-400` | 14 | 500 |
| Section label | `.section-title` | 12 | 600 (UPPERCASE, `tracking-wider`) |
| Metadata | `text-xs text-gray-500 dark:text-gray-400` | 12 | 400 |
| Stat number | `text-2xl sm:text-3xl font-bold tabular-nums` | 24/30 | 700 |

**Tabular numerals are enforced globally on body** — prices, counts, stats all align.

---

## 7. Layout shell — two-row top nav, bottom nav + More sheet

### 7.1 Tree

```
<ThemeProvider>
  <Router>
    <AppShell>
      <TopNav />         ← md+ only. Row 1: brand + search + theme. Row 2: underline tabs.
      <Outlet />
      <BottomNav />      ← md-down only. 4 primary tabs + "More" button → MoreSheet.
    </AppShell>
  </Router>
</ThemeProvider>
```

### 7.2 TopNav — two rows, glass-blurred

```jsx
<header className="hidden md:block sticky top-0 z-40 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-gray-200/60 dark:border-gray-800/60">
  {/* Row 1: brand + search + theme */}
  <div className="max-w-7xl mx-auto px-8 flex items-center gap-6 min-h-[60px]">
    <Brand />
    <GlobalSearch className="flex-1 max-w-2xl mx-auto" />
    <ThemeToggleCompact />
  </div>

  {/* Row 2: underline tabs */}
  <nav className="max-w-7xl mx-auto px-8 flex items-center gap-1 overflow-x-auto scrollbar-none border-t border-gray-100 dark:border-gray-800/60">
    {tabs.map(({ path, label, Icon }) => {
      const active = path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)
      return (
        <NavLink key={path} to={path}
          className={cn(
            'flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors',
            active
              ? 'border-brand-500 text-brand-700 dark:text-brand-300'
              : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          )}>
          <Icon className="w-4 h-4" strokeWidth={2} /> {label}
        </NavLink>
      )
    })}
  </nav>
</header>
```

**Underline pattern** is non-negotiable for desktop tabs. `border-b-2 -mb-px` hides the tab's bottom border against the nav's bottom border.

### 7.3 BottomNav — 4 primary + More

```jsx
<nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-t border-gray-200/60 dark:border-gray-800/60 z-40 shadow-nav"
     style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
  <div className="grid grid-cols-5 max-w-lg mx-auto">
    {primaryTabs.map(({ path, label, Icon }) => (
      <NavLink key={path} to={path} className="min-h-tap py-2 flex flex-col items-center gap-0.5 relative">
        {active && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-0.5 bg-brand-500 rounded-full" />}
        <Icon className="w-5 h-5" strokeWidth={active ? 2.5 : 2} />
        <span className="text-[10px] font-medium">{label}</span>
      </NavLink>
    ))}
    <button onClick={() => setMoreOpen(true)} ...>
      <MoreHorizontal className="w-5 h-5" /> More
    </button>
  </div>
</nav>
<MoreSheet open={moreOpen} onClose={...} items={moreItems} />
```

**Active indicator is a 2px line at the TOP of the active tab** — not a pill bg, not a dot. Trust this.

### 7.4 MoreSheet — bottom-sheet with icon-box rows

Rendered via `createPortal` to `document.body`. Icon-box + label per row (same motif as Settings). Exactly one responsibility: overflow navigation.

### 7.5 PageWrapper

```jsx
export default function PageWrapper({ children, width = 'default', className }) {
  const maxW = width === 'wide' ? 'md:max-w-7xl' : 'md:max-w-5xl'
  return (
    <main className={cn('max-w-lg mx-auto px-4 pt-4 pb-28 md:pb-12 animate-fade-in', maxW, className)}>
      {children}
    </main>
  )
}
```

**`pb-28 md:pb-12` is critical** — mobile content hides under the bottom nav otherwise.

### 7.6 Header — only for DETAIL pages (not list pages)

```jsx
<Header title="Client name" backTo="/clients" right={<EditButton />} />
```

List pages (Home, Schedule, Clients, etc.) use `<PageHero>` inside the page body — NO sticky per-page Header. The page title lives in the hero, not in a sticky bar.

Detail pages (`/clients/:id`, `/work-orders/:id`, etc.) keep the sticky Header with a back button.

---

## 8. Core UI primitives

Port in this order. Each downstream pattern assumes the earlier ones exist.

### 8.1 Card

```jsx
export default function Card({ onClick, className, children, ...props }) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp onClick={onClick}
      className={cn(
        'block w-full text-left bg-white rounded-2xl border border-gray-100 p-4 shadow-card transition-all duration-200 dark:bg-gray-900 dark:border-gray-800',
        onClick && 'cursor-pointer hover:shadow-card-hover hover:border-gray-200 hover:-translate-y-0.5 active:translate-y-0 dark:hover:border-gray-700',
        className,
      )}
      {...props}>
      {children}
    </Comp>
  )
}
```

Pass `className="!p-0"` to remove default padding (for cards wrapping a `divide-y` list).

### 8.2 Icon-box — the most repeated motif

```jsx
<div className="w-10 h-10 rounded-xl bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400 flex items-center justify-center shrink-0">
  <Icon className="w-5 h-5" strokeWidth={2} />
</div>
```

Appears in: Settings rows, StatCards, More sheet items, empty states (sized up to `w-16 h-16 rounded-2xl shadow-glow` with `w-8 h-8` icon), detail-row labels. Swap `brand` for `red/emerald/amber/violet/blue/cyan/pink/indigo/teal` for category coding.

### 8.3 Badge

```jsx
const VARIANTS = {
  default: 'bg-gray-100 text-gray-600 ring-gray-200/50 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700/50',
  primary: 'bg-brand-50 text-brand-700 ring-brand-200/50 dark:bg-brand-950/40 dark:text-brand-300 dark:ring-brand-800/40',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200/50 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/40',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200/50 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800/40',
  danger:  'bg-red-50 text-red-700 ring-red-200/50 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-800/40',
}
export default function Badge({ variant = 'default', dot, children, className }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs font-semibold ring-1 ring-inset', VARIANTS[variant], className)}>
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full', DOT_COLOR[variant])} />}
      {children}
    </span>
  )
}
```

### 8.4 Button

```jsx
const VARIANTS = {
  primary:   'bg-gradient-brand text-white shadow-md shadow-brand-500/20 hover:shadow-lg hover:brightness-110',
  secondary: 'bg-white text-gray-700 border border-gray-200 shadow-card hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-800',
  danger:    'bg-gradient-danger text-white shadow-md shadow-red-500/20 hover:brightness-110',
  ghost:     'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800',
}
const SIZES = {
  sm: 'px-3 py-2 text-xs min-h-[36px]',
  md: 'px-5 py-3 text-sm min-h-tap min-w-tap',
  lg: 'px-6 py-4 text-base min-h-tap',
}
export default function Button({ variant = 'primary', size = 'md', leftIcon: L, rightIcon: R, loading, children, className, ...props }) {
  return (
    <button
      className={cn('inline-flex items-center justify-center gap-2 rounded-xl font-semibold tracking-wide transition-all active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-2 dark:focus:ring-offset-gray-950 disabled:opacity-40',
        VARIANTS[variant], SIZES[size], className)}
      disabled={loading || props.disabled}
      {...props}>
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : L && <L className="w-4 h-4" />}
      {children}
      {!loading && R && <R className="w-4 h-4" />}
    </button>
  )
}
```

Four variants only. **Don't add a fifth.**

### 8.5 Input / TextArea / Select

Use the `.input` class. Wrap with `<Field label hint error>`:

```jsx
<div className="space-y-1.5">
  <label className="block text-sm font-medium text-gray-600 dark:text-gray-400">{label}</label>
  {children}
  {error ? <p className="text-xs text-red-500 font-medium">{error}</p> : hint && <p className="text-xs text-gray-500">{hint}</p>}
</div>
```

**`font-size: 16px` is mandatory** on inputs — anything smaller triggers iOS Safari auto-zoom on focus.

### 8.6 Modal — with `zLayer` for nesting

Bottom sheet on mobile, centered card on desktop. Supports nested modals.

```jsx
const SIZES = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }

export default function Modal({ open, onClose, title, size = 'md', zLayer = 50, children }) {
  useScrollLock(open)  // locks <html>, not body — iOS Safari safe
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 flex items-end sm:items-center justify-center animate-fade-in" style={{ zIndex: zLayer }} role="dialog" aria-modal="true">
      <div className="fixed inset-0 bg-gray-900/40 dark:bg-black/60" onClick={onClose} />
      <div className={cn('relative bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full max-h-[92vh] flex flex-col shadow-elevated animate-slide-up sm:animate-scale-in', SIZES[size])}>
        <div className="sm:hidden absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 bg-gray-200 dark:bg-gray-700 rounded-full" />
        {title && <ModalHeader title={title} onClose={onClose} />}
        <div className="overflow-y-auto overscroll-contain px-6 pb-6">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
```

**`zLayer={60}` on a nested modal renders it above its parent** (e.g. "New Client" opened from inside "New Recurring Service"). The `__add__` sentinel value in Select dropdowns is the clean trigger pattern.

### 8.7 ConfirmModal

```jsx
<ConfirmModal
  open={deleteOpen} onClose={() => setDeleteOpen(false)}
  title="Delete this job?" description="This cannot be undone."
  destructive confirmLabel="Delete"
  onConfirm={async () => { await deleteJob(id) }}
/>
```

Centered warning icon (red/brand depending on `destructive`) + title + description + Cancel/Confirm row. **Never use `window.confirm`.**

### 8.8 FilterChips — auto-centering pill strip

```jsx
<FilterChips
  options={[
    { value: 'all',     label: 'All',     count: 24 },
    { value: 'active',  label: 'Active',  count: 12 },
    { value: 'paused',  label: 'Paused',  count:  3 },
  ]}
  value={filter} onChange={setFilter}
  ariaLabel="Job status"
/>
```

Scrollable pill strip with the **active chip auto-scrolling into center** on change (`scrollIntoView({ inline: 'center' })`). `-mx-4 px-4` lets the row bleed to screen edges.

### 8.9 EmptyState

```jsx
<EmptyState
  icon={Plus}
  title="No clients yet"
  description="Add your first customer to start tracking installs."
  action={<Button onClick={openAdd}>Add Client</Button>}
/>
```

Large icon-box with `shadow-glow`, bold title, muted description, optional action button. Never leave a list blank.

### 8.10 PageHero — title + subtitle + action

```jsx
export default function PageHero({ title, subtitle, action, className }) {
  return (
    <section className={cn('mb-6 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </section>
  )
}
```

Used at the top of every list/dashboard page. Subtitle is **dynamic context** — counts, dates, outstanding totals — not a static description. Action is a primary `<Button leftIcon={Plus}>`.

### 8.11 GlobalSearch — ⌘K header search

A center-placed search component in the TopNav that searches across all major entities. Pattern:

```jsx
<GlobalSearch className="flex-1 max-w-2xl mx-auto" />
```

Behavior:
- `⌘K` / `Ctrl+K` from anywhere focuses + selects
- `Esc` closes the dropdown; outside-click closes
- Debounced (250ms) parallel Supabase queries with `ilike` + `.or()` across 3-5 tables
- Grouped results dropdown (max 5 per group), each group uses a coloured icon-box
- Click a row → `navigate()` to the entity detail page, then reset

**Placeholder copy matters** — lead with your domain's most salient noun:
- Pool app: `"Search pools, clients, addresses..."`
- Window app: `"Search windows, customers, quotes..."`
- HVAC app: `"Search units, jobs, addresses..."`

Skeleton (domain-agnostic):

```jsx
export default function GlobalSearch({ className }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState({})
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)

  // ⌘K shortcut
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); inputRef.current?.focus(); inputRef.current?.select()
      }
      if (e.key === 'Escape' && open) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const runSearch = useCallback(debounce(async (q) => {
    if (q.length < 2) return setResults({})
    setLoading(true)
    const term = `%${q}%`
    // Parallel queries — replace with your entities
    const [a, b, c] = await Promise.all([
      supabase.from('entityA').select('id, name').eq('business_id', bizId).ilike('name', term).limit(5),
      supabase.from('entityB').select('id, ...').eq('business_id', bizId).or(`name.ilike.${term},email.ilike.${term}`).limit(5),
      supabase.from('entityC').select('id, ...').eq('business_id', bizId).ilike('title', term).limit(5),
    ])
    setResults({ entityA: a.data, entityB: b.data, entityC: c.data })
    setLoading(false)
  }, 250), [bizId])

  // Render: <input> with Search icon prefix + ⌘K kbd hint + dropdown
}
```

Dropdown groups render as:

```jsx
<Group label="Windows" count={3}>
  <Row Icon={Square} iconColor="..." iconBg="..."
       title="Sliding — Kitchen" subtitle="Smith residence"
       onClick={() => navigate(`/windows/${id}`)} />
</Group>
```

### 8.12 NewEntityModal pattern — shared shape for quick-create nested modals

For create flows triggered from inside another modal (e.g. "+ New Client" from inside "New Recurring Service"). Sibling components that share a consistent shape:

```jsx
export default function NewClientModal({ open, onClose, onCreated, zLayer = 60, prefill }) {
  const { business } = useBusiness()
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (open) setForm({ ...EMPTY, ...(prefill || {}) }) }, [open, prefill])

  async function handleCreate() {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const { data, error } = await supabase.from('clients').insert({ /* ... */ }).select().single()
      if (error) throw error
      onCreated?.(data)
      onClose?.()
    } catch (err) { alert(err?.message || 'Failed') } finally { setSaving(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="New Client" size="md" zLayer={zLayer}>
      <div className="space-y-4">
        {/* Icon-box header with one-line intent */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400 flex items-center justify-center">
            <UserPlus className="w-5 h-5" strokeWidth={2} />
          </div>
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Quick-add a new client</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">Edit full details later</p>
          </div>
        </div>

        {/* Form fields — keep it short (4-6 fields max) */}
        <Input label="Name" value={form.name} onChange={...} autoFocus required />
        ...

        {/* Sticky-looking two-button row */}
        <div className="flex gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving} className="flex-1">Cancel</Button>
          <Button onClick={handleCreate} loading={saving} disabled={!form.name.trim()} className="flex-1">Create Client</Button>
        </div>
      </div>
    </Modal>
  )
}
```

**Pattern rules:**
- Always at `zLayer={60}` (sits above parent modal at 50)
- Icon-box header with one-line intent + secondary hint
- Form body is INTENTIONALLY SHORT (4-6 fields). If the entity needs more, the "Full details" sub-page owns it.
- Two-button row at bottom: Cancel (secondary) + primary action label naming the entity ("Create Client", "Add Pool", "Add Technician")
- `onCreated(row)` callback returns the inserted row so the parent modal can auto-select it
- `prefill` prop lets the parent pass partial data (e.g. a client name the user typed in a search field)

### 8.13 `onBrand` variant pattern

When a component lives on a gradient/brand-coloured background (e.g. a dashboard hero card with `bg-gradient-brand`), its default light-neutral styling becomes invisible. Add an `onBrand` variant that switches to a frosted white pill.

Example — ActivityBell:

```jsx
export function ActivityBell({ onClick, variant = 'default' }) {
  const onBrand = variant === 'onBrand'
  return (
    <button onClick={onClick}
      className={cn('min-h-tap min-w-tap flex items-center justify-center rounded-xl transition-colors relative',
        onBrand
          ? 'bg-white/15 border border-white/25 hover:bg-white/25 backdrop-blur'
          : 'hover:bg-gray-100/80 dark:hover:bg-gray-800')}>
      <Bell className={cn('w-5 h-5', onBrand ? 'text-white' : 'text-gray-500 dark:text-gray-400')} />
      {count > 0 && (
        <span className={cn('absolute -top-0.5 -right-0.5 rounded-full ...',
          onBrand ? 'bg-white text-red-600 ring-2 ring-brand-600' : 'bg-red-500 text-white')}>
          {count}
        </span>
      )}
    </button>
  )
}
```

Use `onBrand` anywhere an interactive element (icon button, small badge) sits on a coloured hero card. Don't invent new colour rules each time — use this pattern.

---

## 9. Page composition patterns

### 9.1 List page skeleton

```jsx
<PageWrapper size="wide">
  <PageHero
    title="Work Orders"
    subtitle={`${scheduledCount} scheduled · ${inProgressCount} in progress`}
    action={<Button leftIcon={Plus} onClick={openCreate}>New Work Order</Button>}
  />

  <FilterChips className="mb-4" options={FILTERS} value={filter} onChange={setFilter} ariaLabel="Status" />

  <div className="space-y-3">
    {items.map(x => <RowCard key={x.id} item={x} />)}
  </div>
</PageWrapper>
```

### 9.2 List row cards

```jsx
<Card onClick={() => navigate(`/jobs/${job.id}`)}>
  <div className="flex items-start gap-3">
    <div className="w-10 h-10 rounded-xl bg-brand-50 ..."><Icon /></div>
    <div className="flex-1 min-w-0">
      <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{job.title}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{job.client_name}</p>
    </div>
    <div className="shrink-0 text-right">
      <Badge variant={statusVariant(job.status)}>{statusLabel(job.status)}</Badge>
      <p className="text-[10px] text-gray-400 mt-1">{formatRelative(job.scheduled_date)}</p>
    </div>
  </div>
</Card>
```

### 9.3 Detail page

- Sticky `<Header title backTo right={<ActionButtons />}>` with back button + Edit/Delete icon buttons
- Body is a stack of `<Card>`s, each with a `.section-title` heading above
- Edit opens a pre-filled create-modal (dual-mode pattern — same modal handles create + edit via `editing` prop)
- Delete opens `<ConfirmModal destructive>`

### 9.4 Detail-row pattern (info cards)

Inside a `Card`, hairline-divided rows with icon-box labels:

```jsx
<Card className="!p-0 divide-y divide-gray-100 dark:divide-gray-800">
  <DetailRow icon={Pin}   label="Address" value="12 Main St, Sydney" />
  <DetailRow icon={Phone} label="Phone"   value="0412 345 678" />
  <DetailRow icon={Mail}  label="Email"   value="hello@example.com" />
</Card>
```

`!p-0` is the escape hatch that removes Card's default padding so `divide-y` works cleanly.

---

## 10. Settings page — AWC pattern

The clean Settings look is distinctive. Three elements:

1. **Single divided row-link card** with all sub-pages (Business details, Staff, Templates, Automations, etc.). Each row: icon-box + title + description + chevron-right. No section headers between them. Coming-Soon items show a `<Badge>` instead of a chevron.
2. **Appearance section** — its own small card under a `.section-title` "Appearance", containing the three-mode Theme toggle.
3. **Sign out** as a clean secondary button at the bottom (not a red link, not full-width).

No inline forms on the Settings page itself. "Business details" is a row-link to `/settings/business` which contains the form.

```jsx
<PageWrapper>
  <PageHero title="Settings" subtitle={`Signed in as ${user.email}`} />

  <div className="space-y-6">
    {/* Grouped row-link card */}
    <Card className="!p-0 divide-y divide-gray-100 dark:divide-gray-800">
      {SECTIONS.map(s => (
        <button key={s.to} onClick={() => navigate(s.to)} className="w-full flex items-center gap-3 px-4 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60">
          <IconBox color={s.color}><s.Icon /></IconBox>
          <div className="flex-1 min-w-0">
            <p className="font-medium">{s.label}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{s.description}</p>
          </div>
          {s.badge ? <Badge>{s.badge}</Badge> : <ChevronRight className="w-4 h-4 text-gray-400" />}
        </button>
      ))}
    </Card>

    {/* Appearance */}
    <div className="space-y-2">
      <h2 className="section-title">Appearance</h2>
      <Card className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium">Theme</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Choose light, dark, or match your system</p>
        </div>
        <ThemeToggleFull />
      </Card>
    </div>

    {/* Sign out */}
    <button onClick={signOut} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-card hover:bg-gray-50 dark:hover:bg-gray-800 min-h-tap">
      <LogOut className="w-4 h-4" /> Sign out
    </button>
  </div>
</PageWrapper>
```

---

## 11. Porting checklist (work through in order)

Verify build passes after each step.

1. **Install deps** (§3) — `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono`, `clsx`, `tailwind-merge`, `lucide-react`.
2. **Update `tailwind.config.js`** (§4) — `darkMode: 'class'` + the full extend block.
3. **Update `src/styles/index.css`** (§1, §5) — CSS variables + body fonts + transitions + `.section-title`, `.input`, `.card`, `.btn-*`, `.scrollbar-none`.
4. **Add fonts to `main.jsx`** — imports at top (`'@fontsource-variable/inter'`, `'@fontsource-variable/jetbrains-mono'`).
5. **Add FOUC script** to `index.html` `<head>` (§2.1). Use your app's storage key.
6. **Add `ThemeContext`** (§2.2), wrap the app at the root.
7. **Add `cn()` utility** (§3).
8. **Port primitives in this order** and smoke-test each on one page before moving on:
   Card → Badge → Button → Input/TextArea/Select → Modal → ConfirmModal → FilterChips → EmptyState → PageHero → GlobalSearch → NewEntityModal-style sub-modals.
9. **Port layout shell** — TopNav, BottomNav, MoreSheet, PageWrapper, Header (detail-page only), ThemeToggle (both variants). Wire into AppShell.
10. **Rebuild Settings page** per §10.
11. **Migrate list pages** to the §9.1 skeleton. Data hooks stay untouched.
12. **Wire up `GlobalSearch`** with your app's entities (§8.11). Customise placeholder copy.
13. **Smoke-test in both light and dark modes** at mobile (375px) and desktop (1280px) viewports:
    - Header, tabs, page content, bottom nav all render correctly — no colour leaks
    - FilterChips centre the active chip on change
    - Modals bottom-sheet on mobile, centre on desktop
    - `⌘K` focuses GlobalSearch from anywhere
    - Focus rings visible on all interactive elements
    - No console errors, no layout jumps

---

## 12. Things NOT to do

- ❌ **Don't use `bg-white` at the body level.** `bg-slate-50` light, `bg-gray-950` dark.
- ❌ **Don't use sharp corners.** Minimum `rounded-xl` on inputs/cards/buttons.
- ❌ **Don't introduce a 5th button variant.** The four are enough.
- ❌ **Don't use raw black or pure white.** `text-gray-900` / `text-gray-100` is the deepest.
- ❌ **Don't use shadows other than the defined tokens.**
- ❌ **Don't put more than 5 items in the bottom nav.** Use a "More" sheet for overflow.
- ❌ **Don't forget `pb-28 md:pb-12`** on PageWrapper — mobile content hides under the bottom nav.
- ❌ **Don't use `backdrop-blur` inside Modals.** Safari perf dies. Solid `bg-gray-900/40` backdrops only.
- ❌ **Don't use `window.confirm` / `alert` / `prompt`** for anything user-facing. Always a styled Modal.
- ❌ **Don't import framer-motion.** Tailwind transitions + custom easing handle everything.
- ❌ **Don't forget `min-h-tap`** on interactive elements. iOS HIG minimum is 44px.
- ❌ **Don't use `rounded-full` on buttons.** Only for pills, badges, dots, nav indicators.
- ❌ **Don't hardcode brand colours.** Always `brand-*` tokens backed by CSS variables.
- ❌ **Don't skip the FOUC script.** A theme flash on every reload is the single most visible "cheap app" tell.
- ❌ **Don't add section title rows above every card group.** The Settings page combines everything into one divided card — no section headers between groups.
- ❌ **Don't leave inline forms on the main Settings page.** Route each to a sub-page.

---

## 13. Lessons from the field (hard-won)

- **`backdrop-blur` inside Modals** lags badly on iOS Safari. Use solid `bg-gray-900/40` backdrops.
- **Modal scroll lock:** locking `body` overflow doesn't work on iOS. Lock `<html>` with `position: fixed` + saved scroll position.
- **iOS input zoom:** any input with `font-size < 16px` triggers auto-zoom on focus. `.input` enforces 16px.
- **CSS-variable brand colours** are essential for dark mode. Don't try to do it with Tailwind classes alone — you'll end up duplicating every component.
- **Inline FOUC script** must be the first thing in `<head>`. Deferring it to React mount flashes the wrong theme.
- **Three-mode theme toggle beats two-mode.** Light / System / Dark respects OS preference while still letting them override.
- **`scrollIntoView({ inline: 'center' })` on active chip change** in FilterChips is the tiny detail that makes the whole app feel considered.
- **Desktop active-tab indicator**: an underline border (`border-b-2 -mb-px`) beats pill-bg, text-color-only, and dot-below. On mobile, the 2px top line still wins.
- **Nested modals via `zLayer` prop** (default 50, inner 60) lets you open "New Client" from inside "New Recurring Service" without the parent unmounting. The `__add__` sentinel value in select dropdowns triggers the nested modal.
- **`NewEntityModal` sub-modals keep forms SHORT** (4-6 fields). If the user needs more, route them to the entity's full detail page for edit.
- **Dual-mode modals** (same modal handles create + edit via `editing` prop) are cleaner than a separate EditX modal per entity. Hydrate from `editing` with a `fromRecord(editing)` helper.
- **Fire-and-forget activity logging** (write to `activity_feed` in parallel with the primary mutation, never await, never block) keeps the UI fast.
- **Tabular numerals on body** (`font-variant-numeric: tabular-nums`) is the single line of CSS that makes prices, counts, and stats look professional.
- **Icon-box pattern** (`w-10 h-10 rounded-xl bg-X-50 text-X-600`) is the most repeated motif — reuse it in Settings rows, StatCards, More sheet items, EmptyState (sized up), DetailRow labels. Don't invent a new icon treatment.
- **`!p-0` on Cards that wrap divided lists** is the one-line escape hatch — overrides Card's default padding.
- **Realtime/optimistic updates:** trust the local state mutation, then refetch in the background. Never block the UI on a server round-trip after a save.
- **Supabase realtime channel names MUST be unique across StrictMode double-mounts.** Use `crypto.randomUUID()`, NOT `Date.now()` — two effect invocations in the same millisecond reuse the same already-subscribed channel and `.on()` throws.
- **Global search needs to cover your top 3-5 entities at minimum.** Parallel `.ilike()` + `.or()` queries per entity, max 5 results per group, grouped dropdown with icon-box rows.
- **`onBrand` variant** for icons/badges on gradient backgrounds — frosted `bg-white/15 border-white/25 backdrop-blur` with white icon. The default gray styling disappears on coloured cards.
- **Confirmation modals for "this one vs all future"** (recurring items): offer the two buttons in the same modal — never make the user choose in advance.

---

## 14. Reference files

All paths relative to the project root. When in doubt, read the source.

| What | Path |
|---|---|
| Tailwind config | `tailwind.config.js` |
| Global CSS | `src/styles/index.css` |
| FOUC script + HTML head | `index.html` |
| ThemeContext | `src/contexts/ThemeContext.jsx` |
| ThemeToggle (compact + full) | `src/components/layout/ThemeToggle.jsx` |
| AppShell | `src/components/layout/AppShell.jsx` |
| TopNav (desktop, two rows) | `src/components/layout/TopNav.jsx` |
| GlobalSearch (⌘K) | `src/components/layout/GlobalSearch.jsx` |
| BottomNav (mobile, 4 + More) | `src/components/layout/BottomNav.jsx` |
| MoreSheet | `src/components/layout/MoreSheet.jsx` |
| Header (detail-page back bar) | `src/components/layout/Header.jsx` |
| PageWrapper | `src/components/layout/PageWrapper.jsx` |
| PageHero | `src/components/layout/PageHero.jsx` |
| Card, Badge, Button, Input, Modal, ConfirmModal, FilterChips, EmptyState | `src/components/ui/` |
| NewClientModal / NewPoolModal / NewTechnicianModal (sub-modal pattern) | `src/components/ui/New*Modal.jsx` |
| Settings page (row-link + Appearance) | `src/pages/Settings.jsx` |
| Settings sub-page example | `src/pages/settings/BusinessDetails.jsx` |
| Example list page with hero + filter chips | `src/pages/Clients.jsx`, `src/pages/WorkOrders.jsx` |
| Example detail page | `src/pages/ClientDetail.jsx` |

---

## 15. One-paragraph summary

Replace the target app's visual layer with: CSS-variable-driven brand tokens, class-based dark mode with a three-option toggle and FOUC-safe init script, Inter Variable + tabular numerals, `rounded-xl`/`rounded-2xl` shapes with soft multi-layer shadows, a sticky glass-blurred two-row desktop top nav (brand + GlobalSearch + theme on top, underline tabs on bottom), a 5-slot mobile bottom nav with a "More" sheet, a shared auto-centring pill `FilterChips`, dual-mode modals with `zLayer` for nesting, short quick-create `NewEntityModal` sub-modals, a PageHero + dynamic subtitle + primary action on every list page, a ⌘K-accessible global search across your top entities, and a Settings page built as a divided row-link card with a dedicated Appearance subsection. Everything else in the target — its routes, data, auth, business logic — stays untouched.

**Tagline:** *Soft on slate. Dynamic brand. Dark mode by default. ⌘K everywhere. Nothing fancier than it needs to be.*
