// paper-engine.mjs — the ACTION layer. Signals don't just publish; they TRADE (on paper) and the P&L
// proves whether they have edge. Fades funding extremes, rides regime; marks-to-market on live Hyperliquid
// mids; full lifecycle (open → MTM → exit on TP/SL/time/flip) → tracked equity from a $100 paper base.
// PAPER-ONLY: no real order, ever. This is the honest measurement + action loop, keyless, no capital.
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMonitor } from './monitors.mjs';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOK = path.join(LAB, 'data', 'paper-book.json');
const TRADES = path.join(LAB, 'data', 'paper-trades.jsonl');
const BASE = 100;                         // $100 paper base — report dollars
const SIZE_PCT = 0.06;                    // per-trade size (of equity), per-trade not flat-on-everything
const MAX_OPEN = 14;                      // concurrency cap
const TP = 0.025, SL = 0.018, MAX_HOURS = 10; // funding-fade exits
const jsonl = (f) => existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];

async function hlMids() { try { const r = await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'allMids' }), signal: AbortSignal.timeout(8000) }); return await r.json(); } catch { return {}; } }
async function loadBook() { try { return JSON.parse(await readFile(BOOK, 'utf8')); } catch { return { base: BASE, realized: 0, positions: [], opened_total: 0, closed_total: 0, wins: 0, started: new Date().toISOString() }; } }

export async function runPaper() {
  const book = await loadBook();
  const mids = await hlMids();
  const price = (sym) => { const p = +mids[sym]; return Number.isFinite(p) && p > 0 ? p : null; };
  const now = Date.now();

  // ---- 1. mark-to-market + exits on open positions ----
  const stillOpen = [];
  for (const pos of book.positions) {
    const px = price(pos.symbol);
    if (px == null) { stillOpen.push(pos); continue; } // can't price → hold
    const move = pos.side === 'long' ? (px - pos.entry) / pos.entry : (pos.entry - px) / pos.entry;
    const hrs = (now - new Date(pos.opened).getTime()) / 3600e3;
    let exit = null;
    if (move >= TP) exit = 'take-profit';
    else if (move <= -SL) exit = 'stop';
    else if (hrs >= MAX_HOURS) exit = 'time';
    if (exit) {
      const pnl = +(pos.size_usd * move).toFixed(4);
      book.realized = +(book.realized + pnl).toFixed(4);
      book.closed_total++; if (pnl > 0) book.wins++;
      await appendFile(TRADES, JSON.stringify({ ...pos, exit_price: px, exit_reason: exit, pnl_usd: pnl, pnl_pct: +(move * 100).toFixed(2), closed: new Date().toISOString(), hours: +hrs.toFixed(1) }) + '\n');
    } else { pos.mark = px; pos.upnl = +(pos.size_usd * move).toFixed(3); stillOpen.push(pos); }
  }
  book.positions = stillOpen;

  // ---- 2. entries from fresh signals (per-trade sized; never flat) ----
  const open = new Set(book.positions.map(p => p.symbol));
  const equity = book.base + book.realized + book.positions.reduce((a, p) => a + (p.upnl || 0), 0);

  // funding-fade: short the side that pays (crowded) — mean-reversion of positioning
  if (book.positions.length < MAX_OPEN) {
    const f = await runMonitor({ template: 'funding-extreme', label: 'fund', params: { threshold: 0.001 } });
    for (const a of (f.alerts || [])) {
      if (book.positions.length >= MAX_OPEN) break;
      if (open.has(a.symbol)) continue;
      const px = price(a.symbol); if (px == null) continue;
      const side = a.side.includes('longs pay') ? 'short' : 'long'; // fade the crowded side
      const conv = Math.min(2, Math.abs(parseFloat(a.funding)) / 0.1); // |funding| scales size (per-trade conviction)
      const size = +(equity * SIZE_PCT * (0.6 + 0.4 * conv)).toFixed(3);
      book.positions.push({ id: 'p' + (now).toString(36) + Math.random().toString(36).slice(2, 5), symbol: a.symbol, side, entry: px, size_usd: size, opened: new Date().toISOString(), signal: `funding ${a.funding} → fade`, source: 'funding-extreme' });
      book.opened_total++; open.add(a.symbol);
    }
  }
  // regime: extreme fear → BTC paper long (close handled by TP/SL/time like others)
  const s = await runMonitor({ template: 'sentiment-flip', label: 'sent', params: {} });
  const fear = (s.alerts || []).some(a => /extreme fear/i.test(a.trigger));
  if (fear && !open.has('BTC') && book.positions.length < MAX_OPEN) {
    const px = price('BTC'); if (px != null) { book.positions.push({ id: 'pbtc' + now.toString(36), symbol: 'BTC', side: 'long', entry: px, size_usd: +(equity * SIZE_PCT).toFixed(3), opened: new Date().toISOString(), signal: 'extreme fear → contrarian long', source: 'sentiment-flip' }); book.opened_total++; }
  }

  book.equity = +(book.base + book.realized + book.positions.reduce((a, p) => a + (p.upnl || 0), 0)).toFixed(3);
  book.updated = new Date().toISOString();
  await writeFile(BOOK, JSON.stringify(book, null, 2));
  return book;
}

// fast read for the endpoint
export async function paperView() {
  const book = await loadBook();
  const closed = jsonl(TRADES);
  const wins = closed.filter(t => t.pnl_usd > 0).length;
  const equity = book.equity ?? (book.base + book.realized);
  return {
    equity, base: book.base, realized_pnl: +(book.realized || 0).toFixed(3),
    unrealized_pnl: +(book.positions || []).reduce((a, p) => a + (p.upnl || 0), 0).toFixed(3),
    open_positions: (book.positions || []).length, closed_trades: closed.length,
    win_rate: closed.length ? +(100 * wins / closed.length).toFixed(1) : null,
    return_pct: +(((equity - book.base) / book.base) * 100).toFixed(2),
    started: book.started, updated: book.updated,
    positions: (book.positions || []).map(p => ({ symbol: p.symbol, side: p.side, entry: p.entry, mark: p.mark, upnl: p.upnl, size: p.size_usd, signal: p.signal })),
    recent_closed: closed.slice(-10).reverse().map(t => ({ symbol: t.symbol, side: t.side, pnl_usd: t.pnl_usd, pnl_pct: t.pnl_pct, exit: t.exit_reason, hours: t.hours })),
    note: 'Paper book. Signals → real trades → real P&L (mark-to-market on live Hyperliquid mids). $100 base, per-trade sized by funding conviction. PAPER-ONLY — proves edge before any real capital.',
  };
}
