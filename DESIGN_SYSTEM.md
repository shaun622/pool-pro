# Modern Service-Business PWA — Design System

A reusable design system for premium, app-like business tools (field service, dispatch, CRM, inventory). **Crisp white-on-slate** background, **vibrant brand-blue** primary, generous rounding, soft layered shadows, clean sans-serif throughout. Mobile-first with native-app feel — bottom tab bar on phones, sticky top nav on desktop. Built specifically for techs who use it one-handed in the field.

**Stack:** Vite + React 18 + Tailwind CSS 3 + React Router. (Drop-in compatible with Next.js — replace Router with Next's App Router.)

> **How to use this file:** Paste this whole document as the first message in a new project (or save it as `CLAUDE.md` / load it into Claude Projects knowledge). Tell the assistant: *"Use this design system. Brand color is #XXXXXX. App name is YYY. Bottom-nav tabs are: A, B, C, D, E."*

---

## 1. Color tokens

Edit `tailwind.config.js` `theme.extend.colors`:

```js
colors: {
  brand: {                           // rename to your project's primary (e.g. 'pool', 'mint', 'rose')
    50:  '#f0faff',
    100: '#e0f4fe',
    200: '#b9e8fe',
    300: '#7cd7fd',
    400: '#36c1fa',
    500: '#0CA5EB',                  // primary — buttons, active nav, links
    600: '#0084C9',                  // hover
    700: '#0069A3',
    800: '#045886',
    900: '#0A4A6F',
    950: '#062F4A',
  },
}
```

You also rely on Tailwind's built-in palettes for semantics — **do not override them**:

| Use | Palette |
|---|---|
| App background, surface tints | `slate-50`, `gray-50`, `gray-100` |
| Body text | `gray-900` |
| Muted text | `gray-600`, `gray-400` |
| Borders | `gray-100`, `gray-200` |
| Success | `emerald-50` / `emerald-700` |
| Warning | `amber-50` / `amber-700` |
| Danger | `red-50` / `red-700` |
| Info pill | `brand-50` / `brand-700` |

**Rules**

- App background is **always `bg-slate-50`** at the body level — never plain white.
- Cards are **opaque white** (`bg-white`) on top of the slate background — the contrast is the point.
- Primary actions use the **brand gradient** (`bg-gradient-brand`), never flat brand color.
- All status colors come from Tailwind's `50`/`700` pair with a `200/50` ring — see Badge variants below.
- Never use raw black or pure white. `text-gray-900` is the deepest you go.

---

## 2. Tailwind config additions

```js
theme: {
  extend: {
    minHeight: { 'tap': '44px' },           // iOS HIG minimum tap target
    minWidth:  { 'tap': '44px' },

    boxShadow: {
      'card':         '0 1px 3px 0 rgba(0,0,0,0.04), 0 1px 2px -1px rgba(0,0,0,0.03)',
      'card-hover':   '0 4px 12px 0 rgba(0,0,0,0.08), 0 2px 4px -2px rgba(0,0,0,0.04)',
      'elevated':     '0 8px 24px -4px rgba(0,0,0,0.08), 0 4px 8px -4px rgba(0,0,0,0.04)',
      'glow':         '0 0 20px rgba(12,165,235,0.15)',           // recolor with your brand
      'glow-lg':      '0 0 40px rgba(12,165,235,0.20)',
      'nav':          '0 -1px 12px 0 rgba(0,0,0,0.06)',
      'inner-soft':   'inset 0 2px 4px 0 rgba(0,0,0,0.04)',
    },

    backgroundImage: {
      'gradient-brand':       'linear-gradient(135deg, #0CA5EB 0%, #0069A3 100%)',  // 500 → 700
      'gradient-brand-light': 'linear-gradient(135deg, #e0f4fe 0%, #f0faff 100%)',  // 100 → 50
      'gradient-success':     'linear-gradient(135deg, #10b981 0%, #059669 100%)',
      'gradient-danger':      'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
      'gradient-warm':        'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
      'gradient-glass':       'linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.7) 100%)',
      'gradient-page':        'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
    },

    borderRadius: {
      '2xl': '1rem',      // cards, inputs, modals
      '3xl': '1.25rem',   // mobile bottom-sheet tops
    },

    animation: {
      'fade-in':       'fadeIn 0.3s ease-out',
      'slide-up':      'slideUp 0.3s ease-out',
      'scale-in':      'scaleIn 0.2s ease-out',
      'slide-in-right':'slideInRight 0.25s ease-out',
    },
    keyframes: {
      fadeIn:         { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
      slideUp:        { '0%': { opacity: '0', transform: 'translateY(12px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      scaleIn:        { '0%': { opacity: '0', transform: 'scale(0.95)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
      slideInRight:   { '0%': { transform: 'translateX(100%)' }, '100%': { transform: 'translateX(0)' } },
    },
  },
}
```

---

## 3. Global styles (src/styles/index.css)

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html {
    -webkit-tap-highlight-color: transparent;          /* kill iOS grey flash */
  }
  html, body {
    overscroll-behavior: none;                          /* no rubber-band scroll */
  }
  body {
    @apply bg-slate-50 text-gray-900 antialiased;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  /* Strip number-input arrows */
  input[type="number"] { -moz-appearance: textfield; }
  input[type="number"]::-webkit-outer-spin-button,
  input[type="number"]::-webkit-inner-spin-button {
    -webkit-appearance: none; margin: 0;
  }

  * { scroll-behavior: smooth; }

  ::selection { @apply bg-brand-200 text-brand-900; }
}

@layer components {
  /* ── Buttons ─────────────────────────── */
  .btn {
    @apply inline-flex items-center justify-center rounded-xl font-semibold transition-all duration-200
           min-h-tap min-w-tap px-5 py-3 text-sm tracking-wide
           focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-2
           disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none
           active:scale-[0.98];
  }
  .btn-primary {
    @apply btn bg-gradient-brand text-white shadow-md shadow-brand-500/20
           hover:shadow-lg hover:shadow-brand-500/30 hover:brightness-110
           active:shadow-sm;
  }
  .btn-secondary {
    @apply btn bg-white text-gray-700 border border-gray-200 shadow-card
           hover:bg-gray-50 hover:border-gray-300 hover:shadow-card-hover
           active:bg-gray-100;
  }
  .btn-danger {
    @apply btn bg-gradient-danger text-white shadow-md shadow-red-500/20
           hover:shadow-lg hover:shadow-red-500/30 hover:brightness-110;
  }

  /* ── Inputs ──────────────────────────── */
  .input {
    @apply w-full rounded-xl border border-gray-200 bg-white px-4 py-3
           min-h-tap shadow-inner-soft
           placeholder:text-gray-400
           focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400
           disabled:bg-gray-50 disabled:cursor-not-allowed
           transition-all duration-200;
    font-size: 16px;                                   /* MUST be 16px or iOS Safari zooms on focus */
  }
  select.input {
    @apply appearance-none cursor-pointer pr-10;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' viewBox='0 0 24 24' stroke='%239ca3af' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0.75rem center;
    background-size: 1rem;
  }
  .input-lg { @apply input text-2xl font-semibold text-center py-4 tracking-tight; }

  /* ── Cards ───────────────────────────── */
  .card {
    @apply bg-white rounded-2xl border border-gray-100 p-4 shadow-card
           transition-all duration-200;
  }
  .card-interactive {
    @apply card cursor-pointer
           hover:shadow-card-hover hover:border-gray-200 hover:-translate-y-0.5
           active:translate-y-0 active:shadow-card;
  }
  .card-gradient { @apply rounded-2xl p-4 shadow-elevated; }

  /* ── Glass effect (overlay nav, sticky headers) ── */
  .glass { @apply bg-white/80 backdrop-blur-xl border border-white/20; }

  /* ── Section header (above grouped lists) ── */
  .section-title { @apply text-xs font-semibold text-gray-400 uppercase tracking-wider; }
}
```

---

## 4. Component primitives (drop into `src/components/ui/`)

### Button.jsx

```jsx
import { cn } from '../../lib/utils'

const variants = {
  primary:   'btn-primary',
  secondary: 'btn-secondary',
  danger:    'btn-danger',
  ghost:     'btn text-gray-600 hover:bg-gray-100/80 hover:text-gray-900',
}

export default function Button({ children, variant = 'primary', className, loading, ...props }) {
  return (
    <button className={cn(variants[variant], className)} disabled={loading || props.disabled} {...props}>
      {loading && (
        <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  )
}
```

### Card.jsx

```jsx
import { cn } from '../../lib/utils'
export default function Card({ children, className, onClick, ...props }) {
  return (
    <div className={cn(onClick ? 'card-interactive' : 'card', className)} onClick={onClick} {...props}>
      {children}
    </div>
  )
}
```

### Badge.jsx

```jsx
import { cn } from '../../lib/utils'

const variants = {
  default: 'bg-gray-100 text-gray-600 ring-gray-200/50',
  primary: 'bg-brand-50 text-brand-700 ring-brand-200/50',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200/50',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200/50',
  danger:  'bg-red-50 text-red-700 ring-red-200/50',
}

export default function Badge({ children, variant = 'default', className }) {
  return (
    <span className={cn(
      'inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-semibold ring-1 ring-inset',
      variants[variant], className
    )}>
      {children}
    </span>
  )
}
```

### Input.jsx + TextArea + Select export

```jsx
import { cn } from '../../lib/utils'

export default function Input({ label, error, className, large, ...props }) {
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-medium text-gray-600">{label}</label>}
      <input
        className={cn(large ? 'input-lg' : 'input',
                     error && 'border-red-300 focus:ring-red-500/30 focus:border-red-400',
                     className)}
        {...props}
      />
      {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
    </div>
  )
}

export function TextArea({ label, error, className, ...props }) {
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-medium text-gray-600">{label}</label>}
      <textarea
        className={cn('input min-h-[100px] resize-none',
                     error && 'border-red-300 focus:ring-red-500/30 focus:border-red-400',
                     className)}
        {...props}
      />
      {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
    </div>
  )
}

export { default as Select } from './CustomSelect'   // or use a styled native <select className="input">
```

### Modal.jsx — bottom-sheet on mobile, centered card on desktop

```jsx
import { useEffect, useRef } from 'react'

export default function Modal({ open, onClose, title, headerAction, children }) {
  const scrollYRef = useRef(0)

  useEffect(() => {
    if (!open) return
    // Lock <html> scroll position — iOS Safari safe approach
    scrollYRef.current = window.scrollY
    document.documentElement.style.position = 'fixed'
    document.documentElement.style.top = `-${scrollYRef.current}px`
    document.documentElement.style.width = '100%'
    return () => {
      document.documentElement.style.position = ''
      document.documentElement.style.top = ''
      document.documentElement.style.width = ''
      window.scrollTo(0, scrollYRef.current)
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-fade-in">
      {/* Solid backdrop — no backdrop-blur (kills Safari perf in modals) */}
      <div className="fixed inset-0 bg-gray-900/40" onClick={onClose} />

      <div className="relative bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] flex flex-col shadow-elevated animate-slide-up">
        <div className="flex items-center justify-between p-6 pb-0 mb-5">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <div className="flex items-center gap-1">
            {headerAction}
            <button onClick={onClose} className="min-h-tap min-w-tap flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors">
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Drag indicator (mobile only) */}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 bg-gray-200 rounded-full sm:hidden" />

        <div className="overflow-y-auto overflow-x-hidden overscroll-contain px-6 pb-6">
          {children}
        </div>
      </div>
    </div>
  )
}
```

### lib/utils.js

```js
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
export function cn(...args) { return twMerge(clsx(args)) }
```

---

## 5. The responsive nav pattern (top bar desktop, bottom tab bar mobile)

This is the signature layout move. **One layout component renders two completely separate nav implementations** — desktop top bar (`hidden md:block`) and mobile bottom tab bar (`md:hidden fixed bottom-0`). Page bodies don't need extra padding because BottomNav uses `safe-area-inset-bottom` and content scrolls naturally above it.

### BottomNav.jsx

```jsx
import { useLocation, useNavigate } from 'react-router-dom'
import { cn } from '../../lib/utils'

const tabs = [
  { path: '/',           label: 'Home',     icon: HomeIcon },
  { path: '/schedule',   label: 'Schedule', icon: CalendarIcon },
  { path: '/jobs',       label: 'Jobs',     icon: ClipboardIcon },
  { path: '/clients',    label: 'Clients',  icon: UsersIcon },
  { path: '/settings',   label: 'Settings', icon: CogIcon },
]

export default function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-xl border-t border-gray-200/60 z-40 shadow-nav"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex items-center justify-around max-w-lg mx-auto">
        {tabs.map(tab => {
          const active = tab.path === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(tab.path)
          return (
            <button
              key={tab.path}
              onClick={() => { navigate(tab.path); window.scrollTo(0, 0) }}
              className={cn(
                'flex flex-col items-center justify-center min-h-tap min-w-tap py-2 px-3 transition-all duration-200 relative',
                active ? 'text-brand-600' : 'text-gray-400 hover:text-gray-600'
              )}
            >
              {active && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-0.5 bg-brand-500 rounded-full" />}
              <tab.icon active={active} />
              <span className={cn('mt-0.5 text-[10px] font-medium', active && 'font-semibold')}>{tab.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
```

**Key details**
- Frosted glass: `bg-white/90 backdrop-blur-xl`
- **Active indicator is a 2px brand-color line at the TOP** of the active tab — not a pill, not a dot, not an underline-on-text. It floats above the icon.
- Active icon is **filled (solid)**, inactive is **outlined**. (Use Heroicons solid + outline pairs.)
- Labels are `text-[10px]` — intentionally tiny so the icon dominates, like iOS native tabs.
- Exactly **5 tabs max**. More destinations → use a "More" tab.
- `safe-area-inset-bottom` padding so nav clears the iPhone home indicator.

### Header.jsx — page-level top bar with back button

```jsx
import { useNavigate } from 'react-router-dom'
import { cn } from '../../lib/utils'

export default function Header({ title, backTo, right }) {
  const navigate = useNavigate()
  return (
    <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-xl border-b border-gray-100" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <div className="max-w-lg mx-auto flex items-center justify-between px-4 py-3 min-h-[56px]">
        {backTo ? (
          <button onClick={() => navigate(backTo)} className="min-h-tap min-w-tap flex items-center justify-center -ml-2 rounded-xl hover:bg-gray-100 text-gray-600">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        ) : <div className="w-10" />}
        <h1 className="text-base font-bold text-gray-900 truncate">{title}</h1>
        <div className="w-10 flex justify-end">{right}</div>
      </div>
    </header>
  )
}
```

---

## 6. Page layout pattern

Every screen follows the same template. Header → PageWrapper → optional sections.

```jsx
<>
  <Header title="Clients" right={<button onClick={openAdd} className="text-brand-500 font-medium text-sm min-h-tap flex items-center px-2">+ Add</button>} />
  <PageWrapper>
    {/* Sections separated with space-y-4 or space-y-6 */}
    <div className="space-y-4">
      {/* content */}
    </div>
  </PageWrapper>
</>
```

### PageWrapper.jsx

```jsx
export default function PageWrapper({ children, className = '' }) {
  return (
    <main className={`max-w-lg mx-auto px-4 pt-4 pb-24 md:pb-8 ${className}`}>
      {children}
    </main>
  )
}
```

**Container widths**
- `max-w-lg` — the default for everything (mobile-first, ~512px)
- `max-w-2xl` — long forms or detail views with side-by-side fields on desktop
- `max-w-4xl` — admin tables / dashboards with multiple columns

**`pb-24 md:pb-8` is critical** — without it, mobile content scrolls under the bottom nav.

---

## 7. Forms

Stack inputs with `space-y-3` or `space-y-4`. Group paired fields in `grid grid-cols-2 gap-3`.

```jsx
<form onSubmit={handleSubmit} className="space-y-4">
  <Input label="Full Name" name="name" value={form.name} onChange={handleChange} placeholder="e.g. Sarah Chen" />
  <div className="grid grid-cols-2 gap-3">
    <Input label="Phone" name="phone" type="tel" value={form.phone} onChange={handleChange} />
    <Input label="Email" name="email" type="email" value={form.email} onChange={handleChange} />
  </div>
  <TextArea label="Notes" name="notes" value={form.notes} onChange={handleChange} rows={3} />

  <div className="flex gap-2 pt-2">
    <Button variant="secondary" onClick={onCancel} className="flex-1">Cancel</Button>
    <Button type="submit" loading={saving} className="flex-1">Save</Button>
  </div>
</form>
```

**Currency input** — prefix with absolute-positioned `$`:

```jsx
<div className="relative">
  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-medium">$</span>
  <input className="input pl-8" type="number" step="0.01" />
</div>
```

**Inline alerts** (above/below the form):
- Error: `bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3`
- Success: `bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-xl px-4 py-3`
- Info: `bg-brand-50 border border-brand-200 text-brand-700 text-sm rounded-xl px-4 py-3`

---

## 8. Lists (the dominant pattern in service apps)

Most screens are scrollable lists of cards. Each list item is a `Card` with `onClick` → uses `card-interactive`.

```jsx
<div className="space-y-3">
  {items.map(item => (
    <Card key={item.id} onClick={() => navigate(`/items/${item.id}`)}>
      <div className="flex items-center gap-3">
        {/* Avatar / icon block — 44px, brand-tinted */}
        <div className="w-11 h-11 rounded-xl bg-brand-50 flex items-center justify-center shrink-0 text-brand-600">
          <UserIcon className="w-5 h-5" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{item.name}</p>
          <p className="text-xs text-gray-500 truncate">{item.subtitle}</p>
        </div>

        {/* Right-side meta — badge + tiny tertiary text stacked */}
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          <Badge variant={item.statusVariant}>{item.statusLabel}</Badge>
          <span className="text-[10px] font-medium text-gray-400">{item.meta}</span>
        </div>
      </div>
    </Card>
  ))}
</div>
```

**Section grouping** — `<h3 className="section-title">` above each cluster.

```jsx
<h3 className="section-title mt-6 mb-2">Today</h3>
<div className="space-y-3">{...}</div>

<h3 className="section-title mt-6 mb-2">Tomorrow</h3>
<div className="space-y-3">{...}</div>
```

---

## 9. EmptyState pattern

When a list has no items, never just show blank space. Always:

```jsx
<div className="flex flex-col items-center text-center py-16 px-6">
  <div className="w-16 h-16 rounded-2xl bg-brand-50 flex items-center justify-center mb-4 text-brand-500">
    <SomeIcon className="w-8 h-8" />
  </div>
  <h3 className="text-base font-bold text-gray-900 mb-1">No clients yet</h3>
  <p className="text-sm text-gray-500 max-w-xs mb-6">Add your first client to start tracking jobs and sending quotes.</p>
  <Button onClick={openAdd}>Add Client</Button>
</div>
```

---

## 10. Detail-row pattern (info pages)

Inside a `Card`, detail rows separated by hairline borders. Used on detail pages (client profile, job details, settings):

```jsx
<Card className="!p-0 divide-y divide-gray-100">
  <DetailRow icon={<PinIcon />} label="Address" value="123 Beach Rd, Coogee" />
  <DetailRow icon={<PhoneIcon />} label="Phone" value="0412 345 678" />
  <DetailRow icon={<MailIcon />} label="Email" value="hello@example.com" />
</Card>

function DetailRow({ icon, label, value }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center shrink-0 text-brand-600">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
        <div className="text-sm font-medium text-gray-900 truncate">{value || '—'}</div>
      </div>
    </div>
  )
}
```

Note `!p-0` overrides Card's default padding. Use this whenever a card holds a divided list.

---

## 11. Buttons

Four variants only — `primary`, `secondary`, `danger`, `ghost`. Defined as classes in globals.

- Always pill-rounded `rounded-xl` (NOT `rounded-full` — that's only for tab indicators and badges)
- Always `min-h-tap min-w-tap` (44px) for touch targets
- Always `active:scale-[0.98]` for tactile press feedback
- Loading state replaces label with spinner + label (Button component handles this)
- Full-width on mobile by default (`className="w-full"` or `flex-1` inside a flex row)

**Two-button row** (cancel + confirm) — equal width:

```jsx
<div className="flex gap-2 pt-2">
  <Button variant="secondary" onClick={onCancel} className="flex-1">Cancel</Button>
  <Button onClick={onConfirm} loading={saving} className="flex-1">Save</Button>
</div>
```

**Inline icon-button** (e.g. + Add inline):

```jsx
<button className="text-brand-500 font-medium text-sm min-h-tap flex items-center px-2">
  + Add Technician
</button>
```

---

## 12. Confirmation modal pattern

For destructive or branching actions, never use `window.confirm`. Use a styled modal. Common shape:

```jsx
{deleteConfirm && (
  <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
    <div className="absolute inset-0 bg-black/40" onClick={() => setDeleteConfirm(null)} />
    <div className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-6 space-y-4 animate-slide-up">
      <div className="flex justify-center">
        <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
          <WarnIcon className="w-7 h-7 text-red-500" />
        </div>
      </div>
      <div className="text-center">
        <h3 className="text-lg font-bold text-gray-900">Delete Item</h3>
        <p className="text-sm text-gray-500 mt-1">Are you sure? This cannot be undone.</p>
      </div>
      <div className="flex gap-2">
        <button onClick={() => setDeleteConfirm(null)} className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 min-h-tap">Cancel</button>
        <button onClick={handleConfirm} className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 min-h-tap">Delete</button>
      </div>
    </div>
  </div>
)}
```

For multi-option modals (e.g. "Delete this only / Delete all"), stack three full-width buttons vertically.

---

## 13. Animation rules

- Page mount: `animate-fade-in` (300ms fade) — apply to PageWrapper or main containers
- Modal open: backdrop `animate-fade-in` + panel `animate-slide-up` (300ms)
- Inline reveal (e.g. expanding a section): `animate-scale-in` (200ms)
- Button press: `active:scale-[0.98]` (built into `.btn`)
- Hover: `transition-all duration-200`
- **No bouncy / spring animations.** No framer-motion. Tailwind transitions handle everything.

---

## 14. Mobile-first PWA essentials

- **`manifest.json`** with `display: "standalone"`, `theme_color: "#0CA5EB"` (your brand-500), `background_color: "#f8fafc"` (slate-50).
- Apple touch icon in `<head>`.
- Service worker for offline shell (Vite has plugins like `vite-plugin-pwa`).
- Use `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` on every sticky/fixed bar.
- All inputs `font-size: 16px` to prevent iOS Safari zoom on focus (already in `.input`).
- `overscroll-behavior: none` on `html, body` to kill rubber-band scroll outside scroll containers.
- `-webkit-tap-highlight-color: transparent` to kill the iOS grey flash on taps.

---

## 15. Things NOT to do

- ❌ Don't use `bg-white` at the body level — always `bg-slate-50`.
- ❌ Don't use sharp corners — minimum `rounded-xl` on inputs/cards/buttons, `rounded-2xl` on Modal/Card, `rounded-full` only on tiny tab indicators.
- ❌ Don't introduce a 5th button variant.
- ❌ Don't use raw black or pure gray — text is `text-gray-900` / `text-gray-600` / `text-gray-400`.
- ❌ Don't use shadows other than `shadow-card`, `shadow-card-hover`, `shadow-elevated`, `shadow-nav`, or the colored shadows on gradient buttons.
- ❌ Don't put more than 5 items in the bottom nav.
- ❌ Don't forget `pb-24 md:pb-8` on PageWrapper or mobile content hides under the bottom nav.
- ❌ Don't use `backdrop-blur` inside Modals — kills Safari perf; only use it on sticky nav bars.
- ❌ Don't use `window.confirm` / `window.prompt` / `alert` for anything user-facing — always a styled Modal.
- ❌ Don't import framer-motion or any animation library — Tailwind handles everything.
- ❌ Don't forget `min-h-tap` on every interactive element (44px is the iOS HIG minimum).
- ❌ Don't use `rounded-full` on buttons — only `rounded-xl`. (Pills are for badges and nav indicators only.)

---

## 16. Quick-start checklist for a new project

1. `npm create vite@latest myapp -- --template react` (or Next.js)
2. Install `tailwindcss postcss autoprefixer clsx tailwind-merge react-router-dom`
3. Initialize Tailwind: `npx tailwindcss init -p`
4. Copy the `tailwind.config.js` from §1–2 (rename `brand` color to your project's primary)
5. Drop the `globals.css` block from §3 into `src/styles/index.css` and import in main entry
6. Create `src/lib/utils.js` with the `cn()` helper
7. Build the primitives folder `src/components/ui/` (Button, Card, Badge, Input, Modal) from §4
8. Build `BottomNav.jsx` and `Header.jsx` from §5
9. Wrap routes in `AppShell` (Header + Outlet + BottomNav)
10. Create `manifest.json` + Apple touch icon for PWA install
11. Use the page pattern from §6 (Header → PageWrapper → list/cards) for every screen
12. Use the EmptyState pattern from §9 every time a list could be empty
13. Reference §15 every time you're tempted to "improve" the look — usually you shouldn't

---

## 17. Lessons from the field (hard-won)

These are bugs/decisions worth surfacing because they bit hard during PoolPro development:

- **`backdrop-blur` inside Modals** lags badly on iOS Safari. Use solid `bg-gray-900/40` for the backdrop.
- **Modal scroll lock**: locking `body` overflow doesn't work on iOS. Lock `html` with `position: fixed` + saved scroll position (see Modal.jsx in §4).
- **iOS input zoom**: any input with `font-size < 16px` triggers auto-zoom on focus. The `.input` class enforces 16px.
- **`overscroll-behavior: none`** on `html, body` prevents rubber-band scroll, which is essential for a PWA to feel native.
- **Leaflet z-index**: Leaflet panes use z-index 200–700+. Without `isolation: isolate` on `.leaflet-container`, map layers can overlap your modals (z-50). Add `.leaflet-container { isolation: isolate; }` to globals.
- **Nav active state**: a 2px line at the top of the active tab beats every other treatment (color change, pill bg, underline on text, dot below). Trust this.
- **Always `text-[10px]` on bottom-nav labels** — anything bigger looks amateurish next to native iOS apps.
- **Cards with `divide-y` need `!p-0`** to override the Card default padding.
- **Inline edit forms** (e.g. "+ Add Technician" inside a dropdown) should use `__add__` as a sentinel value in Select dropdowns to trigger the inline form. Cleaner than a separate "Add new" button.
- **Geocoding/maps**: never restrict to one country in code — use environment-driven defaults if needed but allow worldwide.
- **Realtime/optimistic updates**: trust the local state mutation, then refetch in the background. Don't block the UI on a network round-trip after a save.
- **Confirmation modals**: for destructive actions on recurring/repeated items, always offer "this one only" vs "all future" as separate buttons in the same modal — don't make the user choose in advance.

---

**Tagline:** *Mobile-first. White on slate. Brand gradient on actions. Nothing fancier than it needs to be.*
