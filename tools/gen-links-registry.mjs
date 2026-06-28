#!/usr/bin/env node
// gen-links-registry.mjs — attach a DEFINITE link to every bi-product avenue.
// Reads all avenue catalogues, resolves the best clickable URL per avenue, and
// writes config/links-registry.json (machine) + docs/AVENUE-LINKS.md (human).
//
// Honesty: each link is tagged `linkSource`:
//   native   = the catalogue entry already carried an exact URL (signup/url/checker) — trust it
//   keyword  = matched a known platform by name → its canonical site
//   category = no exact URL; pointed at the canonical platform/source for that category
//   fallback = generic source of record (DefiLlama / the repo)
// and `linkType`: signup | platform | source | learn | airdrop
//
// Run:  node tools/gen-links-registry.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = (f) => path.join(LAB, 'config', f);
const D = (f) => path.join(LAB, 'data', f);
const REPO = 'https://github.com/sstiempro/mesh';
const J = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const isUrl = (s) => typeof s === 'string' && /^https?:\/\//.test(s);

// ── keyword → canonical link (highest priority; matched against lowercased name) ──
const KW = [
  [/immunefi/, 'https://immunefi.com', 'signup'],
  [/code4rena|code 4rena|\bc4\b/, 'https://code4rena.com', 'signup'],
  [/sherlock/, 'https://audits.sherlock.xyz', 'signup'],
  [/cantina/, 'https://cantina.xyz', 'signup'],
  [/hackenproof|hacken/, 'https://hackenproof.com', 'signup'],
  [/codehawks/, 'https://codehawks.cyfrin.io', 'signup'],
  [/solodit/, 'https://solodit.cyfrin.io', 'source'],
  [/sherlock|spearbit/, 'https://spearbit.com', 'signup'],
  [/zora/, 'https://zora.co', 'platform'],
  [/farcaster|warpcast/, 'https://warpcast.com', 'platform'],
  [/builder score|builderscore/, 'https://www.builderscore.xyz', 'signup'],
  [/talent protocol/, 'https://www.talentprotocol.com', 'signup'],
  [/base builder|base\.org|base app/, 'https://www.base.org/builders', 'signup'],
  [/gitcoin/, 'https://gitcoin.co', 'platform'],
  [/retropgf|retro pgf|optimism/, 'https://app.optimism.io/retropgf', 'platform'],
  [/arbitrum/, 'https://arbitrum.foundation', 'source'],
  [/\bmirror\b/, 'https://mirror.xyz', 'platform'],
  [/paragraph/, 'https://paragraph.xyz', 'platform'],
  [/\bdune\b/, 'https://dune.com', 'platform'],
  [/gumroad/, 'https://gumroad.com', 'platform'],
  [/polymarket/, 'https://polymarket.com', 'platform'],
  [/kalshi/, 'https://kalshi.com', 'platform'],
  [/hyperliquid/, 'https://app.hyperliquid.xyz', 'platform'],
  [/honeygain/, 'https://honeygain.com', 'signup'],
  [/\bgrass\b/, 'https://app.getgrass.io', 'signup'],
  [/nodepay/, 'https://app.nodepay.ai', 'signup'],
  [/gradient/, 'https://app.gradient.network', 'signup'],
  [/io\.net|ionet/, 'https://io.net', 'signup'],
  [/salad/, 'https://salad.com', 'signup'],
  [/brave/, 'https://brave.com/brave-rewards', 'signup'],
  [/presearch/, 'https://presearch.com', 'signup'],
  [/layer3/, 'https://layer3.xyz', 'platform'],
  [/galxe/, 'https://galxe.com', 'platform'],
  [/\btea\b|tea protocol/, 'https://tea.xyz', 'signup'],
  [/virtuals/, 'https://www.virtuals.io', 'platform'],
  [/ethglobal/, 'https://ethglobal.com', 'signup'],
  [/devpost|hackathon/, 'https://devpost.com', 'signup'],
  [/github sponsor/, 'https://github.com/sponsors', 'signup'],
  [/opensea/, 'https://opensea.io', 'platform'],
  [/\bblur\b/, 'https://blur.io', 'platform'],
  [/magic eden/, 'https://magiceden.io', 'platform'],
  [/hummingbot/, 'https://hummingbot.org', 'platform'],
  [/flashbots|\bmev\b/, 'https://docs.flashbots.net', 'learn'],
  [/uniswap/, 'https://app.uniswap.org', 'platform'],
  [/dexscreener/, 'https://dexscreener.com', 'source'],
  [/defillama|llama/, 'https://defillama.com', 'source'],
  [/depinscan|depin/, 'https://depinscan.io', 'source'],
  [/staking ?rewards/, 'https://www.stakingrewards.com', 'source'],
  [/\bn8n\b/, 'https://n8n.io', 'platform'],
  [/snapshot/, 'https://snapshot.org', 'platform'],
];

// ── catalogue::category → canonical pointer (fallback when no exact/keyword link) ──
const CAT = {
  'edge::arb': ['https://dexscreener.com', 'source'],
  'edge::deriv': ['https://app.hyperliquid.xyz', 'platform'],
  'edge::feecap': ['https://hummingbot.org', 'platform'],
  'edge::fringe': ['https://defillama.com', 'source'],
  'edge::mev': ['https://docs.flashbots.net', 'learn'],
  'edge::mm': ['https://hummingbot.org', 'platform'],
  'edge::nft': ['https://blur.io', 'platform'],
  'edge::points': ['https://layer3.xyz', 'platform'],
  'edge::predmkt': ['https://polymarket.com', 'platform'],
  'edge::yield': ['https://defillama.com/yields', 'source'],
  'fringe::ai-content': ['https://zora.co', 'platform'],
  'fringe::airdrop-points': ['https://layer3.xyz', 'platform'],
  'fringe::attention': ['https://warpcast.com', 'platform'],
  'fringe::automation': [REPO, 'source'],
  'fringe::compute-mesh': ['https://io.net', 'signup'],
  'fringe::creator-coins': ['https://zora.co', 'platform'],
  'fringe::data-product': ['https://dune.com', 'platform'],
  'fringe::digital-product': ['https://gumroad.com', 'platform'],
  'fringe::foundation': ['https://gitcoin.co', 'platform'],
  'fringe::gaming': ['https://playtoearn.net', 'source'],
  'fringe::knowledge-arb': ['https://mirror.xyz', 'platform'],
  'fringe::market-liq': ['https://app.uniswap.org', 'platform'],
  'fringe::onchain-create': ['https://zora.co', 'platform'],
  'fringe::security-skill': ['https://immunefi.com', 'signup'],
  'income::airdrop-rhythm': ['https://layer3.xyz', 'platform'],
  'income::arb': ['https://dexscreener.com', 'source'],
  'income::biproduct': ['https://defillama.com', 'source'],
  'income::compound': ['https://defillama.com/yields', 'source'],
  'income::depin': ['https://depinscan.io', 'source'],
  'income::forward-backward': [REPO, 'source'],
  'income::network': ['https://depinscan.io', 'source'],
  'income::node-edge': ['https://www.stakingrewards.com', 'source'],
  'income::portfolio': ['https://defillama.com', 'source'],
  'income::quest': ['https://layer3.xyz', 'platform'],
  'income::world-pulse': [REPO, 'source'],
  'system::agent': ['https://www.virtuals.io', 'platform'],
  'system::content': ['https://mirror.xyz', 'platform'],
  'system::data': ['https://dune.com', 'platform'],
  'system::edge': ['https://gumroad.com', 'platform'],
  'system::fintech': [REPO, 'source'],
  'system::infra': ['https://github.com/sstiempro/mesh', 'platform'],
  'system::monitor': [REPO, 'source'],
  'system::niche': ['https://gumroad.com', 'platform'],
  'system::security': ['https://immunefi.com', 'signup'],
  'system::tools': ['https://github.com/sponsors', 'platform'],
  // income-streams categories
  'income-streams::mining': [REPO, 'source'],     // mining retired — kept for completeness
  'income-streams::depin': ['https://depinscan.io', 'source'],
  'income-streams::builder': ['https://www.builderscore.xyz', 'signup'],
  'income-streams::airdrop': ['https://layer3.xyz', 'platform'],
};

function keyword(name) {
  const n = (name || '').toLowerCase();
  for (const [re, url, type] of KW) if (re.test(n)) return { url, type, src: 'keyword' };
  return null;
}
function resolve({ name, catalogue, category, nativeUrl, nativeType }) {
  if (isUrl(nativeUrl)) return { url: nativeUrl, type: nativeType || 'platform', src: 'native' };
  const kw = keyword(name);
  if (kw) return { url: kw.url, type: kw.type, src: kw.src };
  const key = `${catalogue}::${category}`;
  if (CAT[key]) return { url: CAT[key][0], type: CAT[key][1], src: 'category' };
  return { url: REPO, type: 'source', src: 'fallback' };
}

// ── load every catalogue into a uniform avenue shape ──
const avenues = [];
const push = (o) => avenues.push(o);

// strategy catalogues (no native url) — resolve by keyword/category
for (const [file, arrKey, catalogue] of [
  ['system-plays.json', 'plays', 'system'],
  ['fringe-100.json', 'concepts', 'fringe'],
  ['income-edge-formulations.json', 'formulations', 'income'],
  ['edge-mechanisms.json', 'mechanisms', 'edge'],
]) {
  const d = J(C(file)); if (!d) continue;
  const arr = d[arrKey] || [];
  for (const e of arr) {
    const name = e.name || e.label || e.title || e.id;
    const r = resolve({ name, catalogue, category: e.cat || e.category });
    push({ id: `${catalogue}:${e.id}`, name, catalogue, category: e.cat || e.category,
      note: e.note || e.thesis || e.system || e.how || '', ...r });
  }
}
// free-streams — native `signup`
{
  const d = J(C('free-streams.json'));
  for (const e of (d?.streams || [])) {
    const r = resolve({ name: e.name, catalogue: 'free', category: e.kind, nativeUrl: e.signup, nativeType: 'signup' });
    push({ id: `free:${e.id}`, name: e.name, catalogue: 'free-streams', category: e.kind, note: e.note || '', ...r });
  }
}
// knowledge-capital — native `url`
{
  const d = J(C('knowledge-capital.json'));
  for (const e of (d?.targets || [])) {
    const r = resolve({ name: e.name, catalogue: 'knowledge', category: e.category, nativeUrl: e.url, nativeType: 'signup' });
    push({ id: `knowledge:${e.id}`, name: e.name, catalogue: 'knowledge-capital', category: e.category, note: e.note || '', ...r });
  }
}
// income-streams — source field may be a url; else category map
{
  const d = J(C('income-streams.json'));
  for (const e of (d?.streams || [])) {
    const nativeUrl = isUrl(e.source) ? e.source : null;
    const r = resolve({ name: e.label, catalogue: 'income-streams', category: e.category, nativeUrl });
    push({ id: `istream:${e.id}`, name: e.label, catalogue: 'income-streams', category: e.category,
      note: e.note || (e.status ? `status: ${e.status}` : ''), ...r });
  }
}
// airdrop-radar — native checker_url (NEVER auto-claim; surface checker only)
{
  const d = J(C('airdrop-radar.json'));
  for (const e of (d?.airdrops || [])) {
    const url = isUrl(e.checker_url) ? e.checker_url : (isUrl(e.claim_url) ? e.claim_url : null);
    const r = resolve({ name: e.name, catalogue: 'airdrop', category: e.chain, nativeUrl: url, nativeType: 'airdrop' });
    push({ id: `airdrop:${e.id}`, name: e.name, catalogue: 'airdrop-radar', category: e.chain,
      note: `${e.token || 'TBA'} · ${e.status || ''} · check eligibility, operator signs claims`, ...r, type: 'airdrop' });
  }
}
// airdrop-discovered — native protocol url
{
  const d = J(D('airdrop-discovered.json'));
  for (const e of (d?.candidates || [])) {
    const r = resolve({ name: e.name, catalogue: 'airdrop-discovered', category: e.category, nativeUrl: e.url, nativeType: 'airdrop' });
    push({ id: `disc:${e.id}`, name: e.name, catalogue: 'airdrop-discovered', category: e.category,
      note: `${(e.chains || []).join('/')} · tokenless · ${e.is_new ? 'NEW' : 'tracked'}`, ...r, type: 'airdrop' });
  }
}
// bounty-targets — native url
{
  const d = J(C('bounty-targets.json'));
  for (const e of (d?.targets || [])) {
    const r = resolve({ name: e.name, catalogue: 'bounty-targets', category: e.platform, nativeUrl: e.url, nativeType: 'signup' });
    push({ id: `bounty:${e.id}`, name: e.name, catalogue: 'bounty-targets', category: e.platform,
      note: `$${e.prize_usd?.toLocaleString?.() || e.prize_usd} · ${e.odds || ''}`, ...r });
  }
}

// ── stats ──
const byType = {}, bySrc = {}, byCat = {};
for (const a of avenues) {
  byType[a.type] = (byType[a.type] || 0) + 1;
  bySrc[a.src] = (bySrc[a.src] || 0) + 1;
  byCat[a.catalogue] = (byCat[a.catalogue] || 0) + 1;
}
const exact = avenues.filter(a => a.src === 'native').length;

const registry = {
  _doc: 'Definite link for every bi-product avenue. Generated by tools/gen-links-registry.mjs. linkSource native=exact URL from catalogue; keyword/category=canonical pointer.',
  generated: new Date().toISOString(),
  total: avenues.length,
  exactNativeLinks: exact,
  byType, byLinkSource: bySrc, byCatalogue: byCat,
  avenues,
};
writeFileSync(C('links-registry.json'), JSON.stringify(registry, null, 2));

// ── human doc ──
const ICON = { signup: '✍️', platform: '🛠️', source: '📊', learn: '📚', airdrop: '🪂' };
const SRCNOTE = { native: '', keyword: '', category: '↳ category pointer', fallback: '↳ general source' };
const groups = {};
for (const a of avenues) (groups[a.catalogue] ||= []).push(a);
const order = ['bounty-targets', 'knowledge-capital', 'free-streams', 'airdrop-radar', 'airdrop-discovered',
  'system', 'edge', 'income', 'fringe', 'income-streams'];
const TITLE = {
  'bounty-targets': '🐛 Bug-bounty / audit targets', 'knowledge-capital': '🎓 Builder rewards / grants / contests',
  'free-streams': '💸 Free passive streams (zero capital)', 'airdrop-radar': '🪂 Airdrops — curated (check, never auto-claim)',
  'airdrop-discovered': '🪂 Airdrops — auto-discovered (tokenless DeFi)', 'system': '⚙️ 100 ways to monetize our system',
  'edge': '📈 Edge mechanisms', 'income': '🔁 Income-edge formulations', 'fringe': '🎨 Fringe / creative avenues',
  'income-streams': '🔌 Live income streams',
};
let md = `# Avenue links — every bi-product, one definite link\n\n`;
md += `> Generated ${registry.generated} by \`tools/gen-links-registry.mjs\`. **${avenues.length} avenues**, `;
md += `${exact} with an exact native URL, the rest pointed at the canonical platform/source for their category.\n>\n`;
md += `> Legend: ✍️ signup · 🛠️ platform (where you do it) · 📊 source/data · 📚 learn · 🪂 airdrop (check only — operator signs claims).\n>\n`;
md += `> Honesty: a *category pointer* is "here's where this class of avenue lives," not a one-click form. Foundations-first short list stays in [SIGNUP-LINKS.md](SIGNUP-LINKS.md).\n\n`;
md += `**By link type:** ` + Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${ICON[k] || ''} ${k} ${v}`).join(' · ') + `\n\n`;
md += `**Link precision:** native(exact) ${bySrc.native || 0} · keyword ${bySrc.keyword || 0} · category ${bySrc.category || 0} · fallback ${bySrc.fallback || 0}\n\n---\n`;
for (const g of order) {
  const list = groups[g]; if (!list) continue;
  md += `\n## ${TITLE[g] || g} — ${list.length}\n\n`;
  for (const a of list) {
    const tag = SRCNOTE[a.src] ? ` _${SRCNOTE[a.src]}_` : '';
    const note = a.note ? ` — ${a.note.slice(0, 90)}` : '';
    md += `- ${ICON[a.type] || '🔗'} [${a.name}](${a.url})${tag}${note}\n`;
  }
}
md += `\n---\n_Regenerate: \`node tools/gen-links-registry.mjs\`. Wired live at \`/api/links\` on the dashboard._\n`;
writeFileSync(path.join(LAB, 'docs', 'AVENUE-LINKS.md'), md);

console.log(`✓ ${avenues.length} avenues → config/links-registry.json + docs/AVENUE-LINKS.md`);
console.log(`  exact native links: ${exact} · keyword: ${bySrc.keyword || 0} · category: ${bySrc.category || 0} · fallback: ${bySrc.fallback || 0}`);
console.log(`  by type:`, byType);
