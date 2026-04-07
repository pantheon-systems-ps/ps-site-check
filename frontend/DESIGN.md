# Site Check — Design Study

## Current Problems

1. **Too many flat tabs (9)** — Response, DNS, TLS, Security, SEO, Lighthouse, Pantheon, Email, Subdomains. Users can't scan them all.
2. **Mixed interaction patterns** — tabs, accordions (`<details>`), panels, callouts, inline tables. No consistency.
3. **No visual hierarchy** — everything feels equally important. Users don't know where to look first.
4. **Scores are buried** — Security grade (F), SEO score (68), Lighthouse (85) are hidden inside tabs. They should be the first thing you see.
5. **Information overload** — the Response tab alone has AGCDN headers, IO detection, warmup, cache test, and all headers. Too much at one level.

## Design Principles

1. **Scores first, details on demand** — Show all grades/scores in a dashboard summary. Users scan scores, then drill into what interests them.
2. **Progressive disclosure** — Summary > Section > Details. Never show everything at once.
3. **Consistent sections** — One pattern for all result sections: a card with a header, score/badge, and expandable content.
4. **Scrollable page, not tabs** — Tabs hide content. A scrollable page with collapsible sections lets users scan everything and expand what they need.
5. **Calm design** — Muted backgrounds, clear typography, color only for scores and status. Avoid visual noise.

## Brand

### Colors
- **Primary:** `#4f46e5` (Indigo) — interactive elements, links, active states
- **Success/Good:** `#16a34a` (Green)
- **Warning:** `#ca8a04` (Amber)
- **Error/Poor:** `#dc2626` (Red)
- **Info:** `#2563eb` (Blue)
- **Surface:** `#f9fafb` (Light gray background for cards)
- **Border:** `#e5e7eb`
- **Text primary:** `#1a1a1a`
- **Text secondary:** `#666`
- **Text muted:** `#999`

### Typography
- **Headings:** System sans-serif, semibold (600)
- **Body:** 0.9rem, regular (400), line-height 1.5
- **Labels:** 0.75rem, uppercase, letter-spacing 0.05em, muted color
- **Code:** Monospace, 0.85rem, no background (inline), light gray background (blocks)

### Logo
- Magnifying glass + checkmark SVG in indigo/green
- Used in navbar and favicon only

## Proposed Layout

```
┌─────────────────────────────────────────────┐
│ [Logo] Site Check    Check  Batch  Compare  Migration │
├─────────────────────────────────────────────┤
│                                             │
│  [URL Input] [Resolve Target ▾] [Check]     │
│  ☑ Follow redirects  ☐ Cache test           │
│  ▸ Advanced Options                         │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│  ── Score Dashboard ─────────────────────── │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐       │
│  │  200 │ │  F   │ │  68  │ │  85  │ ...   │
│  │ HTTP │ │ Sec  │ │ SEO  │ │ Perf │       │
│  └──────┘ └──────┘ └──────┘ └──────┘       │
│                                             │
│  [Analyze with AI]     Permalink · abc123   │
│                                             │
│  ▸ Insights (14)                            │
│                                             │
│  ── Performance ────────────────── 85/100 ─ │
│  │ Is It Quick? ✓  | Usable? ⚠ | Resilient? ✓ │
│  │ FCP 1.4s | LCP 2.2s | TBT 426ms | CLS 0.06 │
│  │ ▸ Render-Blocking Resources (7)          │
│  │ ▸ Third-Party Dependencies (12)          │
│  └──────────────────────────────────────────│
│                                             │
│  ── SEO ────────────────────────── 68/100 ─ │
│  │ Title: ✓ (42 chars) | Description: ⚠    │
│  │ H1: 1 | Images: 12/15 alt | Sitemap: ✓  │
│  │ ▸ Full SEO Details                       │
│  └──────────────────────────────────────────│
│                                             │
│  ── Security ───────────────────── Grade F ─ │
│  │ HSTS ⚠ | CSP ✗ | X-Frame ✓ | Referrer ✗ │
│  │ ▸ Full Security Scorecard                │
│  │ ▸ Cookie Audit (3 cookies)               │
│  └──────────────────────────────────────────│
│                                             │
│  ── Infrastructure ─────────────────────── │
│  │ DNS: 23.185.0.252 | TLS 1.3 | Let's Encrypt │
│  │ Pantheon ✓ | Drupal | AGCDN              │
│  │ ▸ DNS Records                            │
│  │ ▸ TLS Certificate Details                │
│  │ ▸ Pantheon Platform Details              │
│  └──────────────────────────────────────────│
│                                             │
│  ── Email Authentication ───────── Grade B ─ │
│  │ SPF ✓ | DKIM ? | DMARC ✓ (p=none)       │
│  │ ▸ Full Email Auth Details                │
│  └──────────────────────────────────────────│
│                                             │
│  ── Response ───────────────────────────── │
│  │ AGCDN Headers (26) | Cache: MISS         │
│  │ ▸ AGCDN Headers Table                    │
│  │ ▸ All Response Headers (48)              │
│  │ ▸ Redirect Chain                         │
│  └──────────────────────────────────────────│
│                                             │
│  ── Subdomains ──────────────── 142 found ─ │
│  │ ▸ View subdomains                        │
│  └──────────────────────────────────────────│
│                                             │
└─────────────────────────────────────────────┘
```

## Insights — First-Class Feature

Insights are curated observations from the Go API's analysis engine. They are the most actionable part of the check and should be **always visible, grouped by severity**.

### Layout
Immediately below the Score Dashboard, before any sections:

```
── Insights ─────────────────────────────────
  CRITICAL (2)
  ┌─ SECURITY — HSTS max-age is only 300s ──────────────┐
  └─ SECURITY — Missing CSP header ─────────────────────┘

  WARNING (4)
  ┌─ CACHE — Vary includes Cookie ──────────────────────┐
  ├─ TLS — Certificate expires in 29 days ──────────────┤
  ├─ CDN — Pantheon backend detected ───────────────────┤
  └─ DNS — SPF record configured ───────────────────────┘

  INFO (8)  ▸ Show 8 informational insights
```

### Rules
- **Errors/Critical**: Always expanded, red left border, light red background
- **Warnings**: Always expanded, amber left border, light amber background
- **Info**: Collapsed by default (expand on click), blue left border
- Group by severity, not by category
- Each insight is a slim card (not a full Callout component)

## AI Analysis — Structured Output

The AI analysis currently renders as a wall of text. It needs structure.

### Layout
```
── AI Analysis ──────────────────── Risk: HIGH ──
│                                                │
│  SUMMARY                                       │
│  ┌──────────────────────────────────────────┐  │
│  │ UFC.com has severe performance problems   │  │
│  │ and critical security gaps...             │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  FINDINGS (10)                                 │
│  ┌─ 🔴 Critical performance (LCP 23.5s) ────┐ │
│  ├─ 🟡 CDN caching leaky (Vary: Cookie) ────┤ │
│  ├─ 🟡 HSTS insufficient (300s) ────────────┤ │
│  ├─ 🔴 Security score F ────────────────────┤ │
│  ├─ 🟡 TLS cert expires in 29 days ─────────┤ │
│  └─ ... ─────────────────────────────────────┘ │
│                                                │
│  NEXT STEPS                                    │
│  ┌─ 1. Reduce page weight (10.6 MB → <3 MB) ┐ │
│  ├─ 2. Add CSP and security headers ─────────┤ │
│  ├─ 3. Fix HSTS max-age to 31536000 ─────────┤ │
│  ├─ 4. Enable Redis object caching ──────────┤ │
│  └─ 5. Add New Relic for observability ──────┘ │
│                                                │
│  28583ms via Claude Opus 4.6                   │
└────────────────────────────────────────────────┘
```

### Rules
- **Summary**: Gray background card, larger text
- **Findings**: Each finding is a card with severity color (parse `**` bold markers)
  - Contains `critical` or `performance score` or `F` → red
  - Contains `warning` or `leaky` or `insufficient` → amber
  - Otherwise → blue
- **Next Steps**: Numbered list with clear action items, each in its own card
- **Risk badge**: Colored pill in the header (green/amber/red)
- Parse markdown bold (`**text**`) and render as actual bold
- Parse inline code (backticks) and render as `<code>`

## Key Changes from Current Design

### 1. Replace tabs with scrollable sections
Each section is a collapsible card with:
- Section title on the left
- Score/grade badge on the right
- 1-line summary always visible
- Expandable details below

### 2. Score Dashboard at the top
A grid of score cards visible immediately:
- HTTP Status (color-coded)
- Security Grade (A-F)
- SEO Score (0-100)
- Performance Score (0-100) — from Lighthouse, shows spinner while loading
- Email Grade (A-F)
- Pantheon (Yes/No + CDN tier)

Each card is clickable — scrolls to that section.

### 3. Group into 6 meaningful sections
Instead of 9 flat tabs:
1. **Performance** — Lighthouse scores, WPT assessments, metrics, render-blocking, 3rd parties
2. **SEO** — title, meta, headings, images, robots.txt, sitemap, structured data
3. **Security** — headers scorecard, cookies, HSTS preload
4. **Infrastructure** — DNS, TLS, Pantheon detection (these are related)
5. **Email Authentication** — SPF/DKIM/DMARC
6. **Response** — raw headers, AGCDN analysis, cache test, redirect chain
7. **Subdomains** — CT log discovery (collapsed by default)

### 4. Section card component
Every section follows the same pattern:

```tsx
<SectionCard
  title="Security"
  score={{ value: "F", color: "#dc2626" }}
  summary="3/10 headers present. No CSP. HSTS max-age too short."
  defaultOpen={false}
>
  {/* Detailed content */}
</SectionCard>
```

### 5. Performance section uses Lighthouse loading state
The Performance section shows:
- Score gauge (or spinner if loading)
- Quick/Usable/Resilient cards
- Metrics grid
- Expandable sub-sections for render-blocking and 3rd parties

## Component Inventory

| Component | Usage |
|-----------|-------|
| `ScoreDashboard` | Top-level score grid |
| `ScoreCard` | One score in the dashboard (HTTP, Security, SEO, etc.) |
| `SectionCard` | Collapsible section with title, score, summary |
| `MetricsGrid` | Grid of metric cards (DNS ms, HTTP ms, etc.) |
| `ScoreGauge` | Circular SVG gauge for Lighthouse |
| `AssessmentCard` | Quick/Usable/Resilient verdict card |
| `Badge` | Inline colored pill |
| `StatusBadge` | HTTP status code display |
| `TabSpinner` | Loading spinner for async sections |
| `AIAnalysisPanel` | AI analysis with generate button |

## Responsive Behavior

- **Desktop (>1024px):** Full-width sections, score dashboard in 6-column grid
- **Tablet (768-1024px):** Score dashboard in 3-column grid, sections full-width
- **Mobile (<768px):** Score dashboard in 2-column grid, sections stack vertically

## Implementation Plan

1. Create `SectionCard` component
2. Create `ScoreDashboard` component
3. Refactor `_index.tsx` to use scrollable sections instead of tabs
4. Group DNS + TLS + Pantheon into "Infrastructure" section
5. Move AGCDN headers, cache test, redirect chain into "Response" section
6. Each section starts collapsed, expands on click
7. Score dashboard cards scroll to their section on click
