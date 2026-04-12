# Modern Hospitality PWA — Design System

A reusable design system for premium, app-like web projects. Calm cream background, deep brand color, generous rounding, subtle shadows, serif display headings paired with clean sans body. Mobile-first, but the desktop experience is intentional — not a stretched mobile view.

**Stack:** Next.js 15 App Router + Tailwind CSS 3 + lucide-react icons.

> **How to use this file:** Paste this whole document as the first message in a new project (or save it as `CLAUDE.md` / load it into Claude Projects knowledge). Tell the assistant: *"Use this design system. Brand color is #XXXXXX. Accents are #YYYYYY (success), #ZZZZZZ (alert), #AAAAAA (warning)."*

---

## 1. Color tokens

Edit `tailwind.config.ts` `theme.extend.colors` with:

```ts
colors: {
  cream: '#FFFEF0',                   // app background — never use plain white
  brand: {                             // rename to your project's primary
    DEFAULT: '#155162',                // deep teal — text + buttons
    50:  '#E8EEF0',
    100: '#C5D4D9',
    500: '#155162',
    600: '#124555',                    // hover
    700: '#0E3844',
    900: '#071C22',
  },
  // 3 accent colors for status / highlights — green / red / orange triplet works well
  accent1: '#5E8364',  // success / positive
  accent2: '#D05B47',  // alert / error / heart
  accent3: '#F4861A',  // warning / highlight
}
```

**Rules**

- Background is always `bg-cream` — never plain white at the page level.
- Brand color is the only "dark" color — use `text-brand`, `bg-brand`, `border-brand/10`, `bg-brand/5` for soft hovers. Use `/40`, `/60`, `/70` opacity for muted text. Never use raw black or pure gray.
- Cards are `bg-white/60 backdrop-blur-sm` — translucent white, never opaque.

---

## 2. Typography

```ts
fontFamily: {
  sans:    ['var(--font-inter)',    'system-ui', 'sans-serif'],   // body
  display: ['var(--font-playfair)', 'Georgia',   'serif'],        // headings
}
```

Load Inter + Playfair Display via `next/font` in the root layout. Headings use `font-display`. Sizes:

- **Page title:** `font-display text-4xl md:text-5xl text-brand`
- **Section title:** `font-display text-2xl text-brand`
- **Eyebrow above title:** `text-brand/60 text-sm uppercase tracking-widest`
- **Body:** default sans, `text-brand` or `text-brand/70`

---

## 3. Tailwind config additions

```ts
animation: {
  'fade-in':    'fadeIn 0.4s ease-out',
  'slide-up':   'slideUp 0.5s ease-out',
  'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
},
keyframes: {
  fadeIn:    { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
  slideUp:   { '0%': { opacity: '0', transform: 'translateY(12px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
  pulseSoft: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.7' } },
},
boxShadow: {
  soft: '0 2px 20px -4px rgba(21, 81, 98, 0.08)',   // use your brand RGB
  card: '0 4px 24px -6px rgba(21, 81, 98, 0.12)',
},
```

---

## 4. globals.css

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --background: #FFFEF0;
  --foreground: #155162;
}

html, body {
  background: var(--background);
  color: var(--foreground);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

/* Safe-area helpers for PWA on notched phones */
.safe-top    { padding-top: env(safe-area-inset-top); }
.safe-bottom { padding-bottom: env(safe-area-inset-bottom); }

/* Hide scrollbar but allow scrolling */
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

/* Stop iOS zoom on input focus */
input, select, textarea { font-size: 16px; }
@media (min-width: 640px) {
  input, select, textarea { font-size: inherit; }
}

/* Page enter animation */
.page-enter { animation: fadeIn 0.4s ease-out; }
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Buttons — pill-shaped, soft shadow, tactile press */
.btn {
  @apply inline-flex items-center justify-center gap-2 rounded-full px-6 py-3
         font-medium transition-all duration-200 active:scale-[0.98]
         disabled:opacity-50 disabled:pointer-events-none;
}
.btn-primary   { @apply btn bg-brand text-cream hover:bg-brand-600 shadow-soft; }
.btn-secondary { @apply btn bg-cream border border-brand/20 text-brand hover:bg-brand/5; }
.btn-ghost     { @apply btn text-brand hover:bg-brand/5; }

/* Card — frosted white with brand-tinted border */
.card {
  @apply bg-white/60 backdrop-blur-sm rounded-3xl border border-brand/10 shadow-soft;
}
```

---

## 5. The responsive nav pattern (top bar desktop, bottom bar mobile)

This is the signature layout move. One layout component renders **two completely separate nav implementations** — desktop top bar and mobile bottom tab bar — and toggles them with `hidden md:block` / `md:hidden`. The page body has `pb-24 md:pb-0` so mobile content never sits under the bottom bar.

```tsx
import Link from 'next/link';
import { Home, Wallet, Sparkles, Gift, QrCode, User } from 'lucide-react';

const navItems = [
  { href: '/dashboard',          label: 'Home',     icon: Home },
  { href: '/dashboard/wallet',   label: 'Wallet',   icon: Wallet },
  { href: '/dashboard/points',   label: 'Points',   icon: Sparkles },
  { href: '/dashboard/vouchers', label: 'Vouchers', icon: Gift },
  { href: '/dashboard/qr',       label: 'My QR',    icon: QrCode },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-cream pb-24 md:pb-0">

      {/* DESKTOP HEADER — sticky top bar with logo, pill nav, account */}
      <header className="hidden md:block safe-top sticky top-0 z-30
                         bg-cream/80 backdrop-blur-md border-b border-brand/10">
        <div className="max-w-6xl mx-auto px-5 py-4 flex items-center justify-between">
          <Link href="/dashboard"><Logo /></Link>

          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href}
                className="flex items-center gap-2 px-4 py-2 rounded-full text-sm
                           text-brand/70 hover:text-brand hover:bg-brand/5 transition">
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link href="/account" className="btn-ghost text-sm px-3 py-2">
              <User className="w-4 h-4" />
              Account
            </Link>
            <LogoutButton />
          </div>
        </div>
      </header>

      {/* MOBILE HEADER — minimal: just logo + account icon */}
      <header className="md:hidden safe-top sticky top-0 z-30
                         bg-cream/80 backdrop-blur-md border-b border-brand/10">
        <div className="px-5 py-4 flex items-center justify-between">
          <Logo size="sm" />
          <Link href="/account" className="text-brand p-2">
            <User className="w-5 h-5" />
          </Link>
        </div>
      </header>

      <div className="page-enter">{children}</div>

      {/* MOBILE BOTTOM NAV — fixed, frosted, 5-col grid, tiny labels */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40
                      bg-cream/90 backdrop-blur-md border-t border-brand/10 safe-bottom">
        <div className="grid grid-cols-5 py-2">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}
              className="flex flex-col items-center gap-1 py-1.5 text-brand/60 hover:text-brand">
              <item.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
```

**Key details**

- Both bars use `bg-cream/80 backdrop-blur-md` — frosted glass over the cream background.
- Pill-shaped desktop nav links (`rounded-full px-4 py-2`) — never underlines or boxes.
- Bottom nav is exactly **5 columns max**. More than 5 destinations → add a "More" tab.
- Icon size differs: `w-4 h-4` desktop, `w-5 h-5` mobile.
- Bottom-nav labels are `text-[10px]` — tiny so the icon dominates, like iOS native tabs.
- `safe-top` / `safe-bottom` pad for iPhone notch + home indicator when running as installed PWA.
- **`pb-24 md:pb-0` on the wrapper is critical** — without it mobile content scrolls under the bottom bar.
- Page wrapper has `page-enter` class — every navigation gets a 400ms fade+slide.

---

## 6. Page layout pattern

Every page follows the same structure:

```tsx
<main className="max-w-3xl mx-auto px-5 py-6 md:py-10 space-y-8">
  {/* Header block */}
  <div>
    <p className="text-brand/60 text-sm uppercase tracking-widest">Eyebrow label</p>
    <h1 className="font-display text-4xl md:text-5xl text-brand">Page title</h1>
  </div>

  {/* Sections separated by space-y-8 */}
  <section>...</section>
  <section>...</section>
</main>
```

**Container widths**

- `max-w-3xl` — single-column content pages (forms, dashboards)
- `max-w-5xl` — detail pages with 2-column form grids
- `max-w-6xl` — admin tables / wide data
- `max-w-7xl` — full-width admin layouts

Padding: `px-5 py-6 md:py-10` everywhere — never less, never more.

---

## 7. Hero balance card

The "headline number" card — deep brand-color background with a subtle gradient, eyebrow, huge serif number, fine print. Use this for wallet balance, points totals, lifetime spend, anything that wants to be the visual anchor of a page.

```tsx
<div className="relative overflow-hidden rounded-3xl bg-brand p-8 shadow-card">
  {/* Gradient overlay — light from top-left, dark to bottom-right */}
  <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/20" />

  <div className="relative text-cream">
    <div className="flex items-center gap-2 mb-3 opacity-80">
      <Wallet className="w-5 h-5" />
      <span className="text-sm">Available to spend</span>
    </div>
    <div className="font-display text-6xl">$1,234.50</div>
    <div className="text-cream/70 text-sm mt-2">Usable at any venue</div>
  </div>
</div>
```

Swap `bg-brand` for `bg-accent1`, `bg-accent2`, etc. for variant cards (e.g. red voucher card, green points card).

---

## 8. Forms

**Input pattern (use this verbatim):**

```html
className="w-full bg-white border border-brand/15 rounded-2xl px-4 py-3 text-brand
           focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
```

- Pill-rounded `rounded-2xl` (not `rounded-full` — that's for buttons)
- White fill, soft brand border
- Focus state: solid brand border + 4px brand-tinted ring

**Currency input** — prefix with absolute-positioned `$`:

```tsx
<div className="relative">
  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-brand/60">$</span>
  <input className="w-full bg-white border border-brand/15 rounded-2xl pl-8 pr-4 py-3 text-brand focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" />
</div>
```

**Labels above inputs:** `block text-sm font-medium text-brand mb-1.5`

**Field grouping:** `grid sm:grid-cols-2 gap-3` for paired fields, `space-y-3` for stacked.

**Forms wrap in a card:** `<form className="card p-6 space-y-4 max-w-xl">`

**Inline alerts:**
- Error: `bg-accent2/10 border border-accent2/30 text-accent2 text-sm rounded-2xl px-4 py-3`
- Success: `bg-accent1/10 border border-accent1/30 text-accent1 text-sm rounded-2xl px-4 py-3`

---

## 9. Buttons

Three variants only — defined as `.btn-primary`, `.btn-secondary`, `.btn-ghost` in globals.css.

- Always pill-shaped (`rounded-full`)
- Always have `active:scale-[0.98]` for tactile feedback
- Loading state uses `lucide-react`'s `Loader2` with `animate-spin`:
  ```tsx
  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit'}
  ```
- Icon buttons put the icon left of label with `gap-2` (handled by `.btn` base)
- Full-width on mobile, auto-width on desktop — let parent control with `w-full`

**Card-style action buttons** (when you want a button that lives inside a card panel and feels less prominent than the primary CTA):

```tsx
<button className="w-full inline-flex items-center justify-center gap-2
                   bg-brand/5 hover:bg-brand/10 border border-brand/15 text-brand
                   font-medium rounded-2xl py-3 transition disabled:opacity-50">
  <KeyRound className="w-4 h-4" /> Send password reset
</button>
```

**Destructive variant** — same shape but in `accent2`:

```tsx
className="w-full inline-flex items-center justify-center gap-2
           bg-accent2/10 hover:bg-accent2/20 border border-accent2/30 text-accent2
           font-medium rounded-2xl py-3 transition disabled:opacity-50"
```

---

## 10. Tables (admin lists)

Wrap in a card with horizontal scroll for narrow viewports:

```tsx
<div className="card overflow-x-auto">
  <table className="w-full text-sm">
    <thead>
      <tr className="text-left text-brand/60 border-b border-brand/10">
        <th className="py-3 px-4 font-medium">Column</th>
      </tr>
    </thead>
    <tbody>
      <tr className="border-b border-brand/5 hover:bg-brand/5 cursor-pointer transition-colors">
        <td className="py-3 px-4 font-medium text-brand">Cell</td>
      </tr>
    </tbody>
  </table>
</div>
```

**Status badges inside cells:**

```tsx
<span className="text-xs font-medium px-2 py-0.5 rounded-full bg-accent1/10 text-accent1">
  active
</span>
```

**Whole rows are clickable** when there's a detail page — convert the row to a client component with `onClick={() => router.push(href)}` and `cursor-pointer`. Add a `›` chevron in the last column. Don't rely on a tiny "Open" link.

---

## 11. Animation rules

- Page enters: 400ms fade + 8px slide-up (`page-enter` class on the layout's `<div>` wrapping `{children}`).
- Button presses: `active:scale-[0.98]` (built into `.btn`).
- Hover transitions: `transition-all duration-200`.
- Use `animate-fade-in` / `animate-slide-up` keyframes for one-off elements.
- **No bouncy / spring animations.** No framer-motion needed.

---

## 12. PWA install bonuses

- `manifest.json` with `display: standalone`, `theme_color: "#FFFEF0"`, `background_color: "#FFFEF0"`.
- Apple touch icon in `<head>`.
- Service worker for offline fallback.
- Use `safe-top` / `safe-bottom` everywhere there's a sticky/fixed bar.
- All inputs `font-size: 16px` to prevent iOS Safari zoom.

---

## 13. Things NOT to do

- ❌ Don't use `bg-white` at the page level — always `bg-cream`.
- ❌ Don't use sharp corners — minimum `rounded-2xl` on inputs/cards, `rounded-full` on buttons/badges.
- ❌ Don't introduce a 4th button style.
- ❌ Don't underline nav links — use background color shifts.
- ❌ Don't use raw black or pure gray — everything is `text-brand` at varying opacities (`/40`, `/60`, `/70`).
- ❌ Don't use shadows other than `shadow-soft` and `shadow-card`.
- ❌ Don't put more than 5 items in the bottom nav.
- ❌ Don't forget `pb-24 md:pb-0` on the layout wrapper or mobile content will hide under the bottom nav.
- ❌ Don't import framer-motion or any other animation library — Tailwind transitions handle everything.

---

## 14. Quick-start checklist for a new project

1. Install Tailwind CSS 3, copy the `tailwind.config.ts` color/font/animation/shadow tokens (rename `brand` if you want).
2. Load Inter + Playfair Display via `next/font` in `app/layout.tsx`.
3. Drop the `globals.css` block above into `app/globals.css`.
4. Build the responsive nav layout from §5 — it goes in `app/(authed)/layout.tsx` or your equivalent.
5. Add `manifest.json` + Apple touch icon for PWA install.
6. Build pages using the §6 page pattern — eyebrow + display title + sections.
7. Use the hero card from §7 for any headline number.
8. Use the form, button, and table patterns from §8–10 for everything else.
9. Reference §13 every time you're tempted to "improve" the look — usually you shouldn't.
