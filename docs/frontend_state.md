# Frontend State Management & Virtualized Log Streaming

This document details the frontend state organization, UI rendering optimizations, and multi-tab isolation strategy.

## 1. Multi-Tab Isolated State Model

Each project is mapped to an isolated tab state structure in React to ensure independent UI rendering:

```typescript
interface ProjectTabState {
  id: string;
  name: string;
  command: string;
  status: 'STOPPED' | 'SETUP' | 'RUNNING' | 'CRASHING' | 'TERMINATED' | 'FATAL';
  cpuHistory: number[];    // Last 30 data points
  ramHistory: number[];    // Last 30 data points (in MB)
  currentCpu: number;
  currentRam: number;
  terminalLogs: LogLine[];
}

interface LogLine {
  text: string;
  stream: 'stdout' | 'stderr';
  timestamp: number;
}
```

---

## 2. High-Frequency Log Streaming Virtualization

When development servers (like Webpack or Next.js) boot, they can emit thousands of lines of logs in a few seconds. Appending these logs directly to a standard `<pre>` or `<div>` tag causes severe browser layout thrashing and eventually crashes the UI thread.

### Virtualization & Ring-Buffer Optimizations:
1. **Ring Buffer Cap:** Each tab's log store is capped at a strict limit (e.g. 2,000 lines). Once reached, the oldest lines are popped to keep memory consumption constant.
2. **Batching Updates:** Instead of rendering on every single IPC log event, updates are queued. Every 60ms (roughly matching a $60\text{Hz}$ monitor refresh cycle), the queue is flushed into the state in a single batch update.
3. **List Virtualization:** We implement terminal line virtualization. Only the lines currently visible within the viewport are rendered in the DOM, keeping DOM node count incredibly small regardless of total log count.
4. **Auto-Scroll Behavior:** The terminal window auto-scrolls down only if the user's viewport is already at the bottom. If the user scrolls up to inspect logs, auto-scroll is paused to prevent shifting text under the user's eyes.

---

## 3. Dynamic Dark/Light Theme Context

To maintain highly rigid, professional visual aesthetics, we use a custom theme engine:
- CSS variables are injected at the root layer based on active context.
- Dark mode utilizes strict charcoal/slate colors to ensure terminal legibility.

### Theme Spec Palette:

| Color Token | Dark Value | Light Value | Purpose |
|---|---|---|---|
| `--bg-primary` | `#121214` (Slate Black) | `#FAFAFA` (Pure White) | Shell Background |
| `--bg-secondary` | `#1A1A1E` (Charcoal) | `#F0F0F2` (Soft Gray) | Sidebar / Panels |
| `--border-primary`| `#2C2C35` (Slate Border) | `#E2E2E6` (Light Border)| Bounding boxes & grids |
| `--text-primary` | `#EDEDF0` (Off-white) | `#1A1A1E` (Dark Charcoal)| High-contrast titles |
| `--text-muted` | `#8A8A93` (Slate Gray) | `#62626A` (Dark Gray) | Secondary labels |
| `--color-accent` | `#3A86FF` (Vibrant Blue)| `#0056E0` (Deep Blue) | Primary button & graphs |
