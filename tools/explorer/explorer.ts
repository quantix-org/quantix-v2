#!/usr/bin/env tsx
/**
 * Quantix Block Explorer — standalone HTTP server
 *
 * Usage:
 *   tsx tools/explorer/explorer.ts [node-rpc-url] [port]
 *
 * Defaults:
 *   node-rpc-url  http://localhost:7331/rpc   (devnet validator-1)
 *   port          8080
 */

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";


const nodeRpc = process.argv[2] ?? "http://localhost:7331/rpc";
const explorerPort = Number(process.argv[3] ?? "9933");

// ─── RPC proxy ───────────────────────────────────────────────────────────────

async function proxyRpc(method: string, params: unknown[] = []): Promise<unknown> {
  const res = await fetch(nodeRpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

// ─── Server ───────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";

  if (req.method === "POST" && url === "/rpc") {
    try {
      const body = await readBody(req);
      const { method, params } = JSON.parse(body) as { method: string; params?: unknown[] };
      const result = await proxyRpc(method, params ?? []);
      sendJson(res, 200, { result });
    } catch (err) {
      sendJson(res, 200, { error: { message: String(err) } });
    }
    return;
  }

  if (req.method === "GET" && (url === "/" || url === "/index.html")) {
    sendHtml(res, HTML);
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(explorerPort, () => {
  console.log(`Quantix Block Explorer  →  http://localhost:${explorerPort}`);
  console.log(`Proxying RPC to         →  ${nodeRpc}`);
});

// ─── HTML ─────────────────────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quantix Explorer</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0d1117;--surface:#161b22;--surface2:#1c2128;
  --border:#21262d;--border2:#30363d;
  --text:#e6edf3;--muted:#8b949e;--muted2:#484f58;
  --accent:#4f8ef7;--green:#3fb950;--red:#f85149;
  --orange:#f0883e;--purple:#bc8cff;--yellow:#d29922;
  --mono:'Cascadia Code','Fira Code','Consolas',monospace;
  --r:6px;
}
html,body{height:100%}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.5}
a{color:var(--accent);text-decoration:none;cursor:pointer}
a:hover{text-decoration:underline}
.topbar{position:sticky;top:0;z-index:100;background:rgba(22,27,34,.95);backdrop-filter:blur(10px);border-bottom:1px solid var(--border);min-height:56px;height:auto;padding:10px 20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.logo{display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;color:var(--accent);white-space:nowrap;cursor:pointer;text-decoration:none;flex-shrink:0}
.logo:hover{text-decoration:none;opacity:.85}
.search-box{flex:1;min-width:0;max-width:540px;display:flex;align-items:center;background:var(--bg);border:1px solid var(--border2);border-radius:20px;padding:0 14px;gap:8px;transition:border-color .15s}
.search-box:focus-within{border-color:var(--accent)}
.search-box input{flex:1;background:transparent;border:none;outline:none;color:var(--text);font-family:var(--mono);font-size:12px;padding:8px 0}
.search-box input::placeholder{color:var(--muted2)}
.search-box button{background:none;border:none;color:var(--muted);cursor:pointer;padding:0;display:flex;align-items:center}
.search-box button:hover{color:var(--accent)}
.live{width:8px;height:8px;border-radius:50%;background:var(--muted2);transition:background .3s;flex-shrink:0}
.live.on{background:var(--green)}
#app{max-width:1200px;margin:0 auto;padding:20px 16px;min-width:0}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:18px}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:14px 16px}
.stat .lbl{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px}
.stat .val{font-family:var(--mono);font-size:22px;font-weight:700;color:var(--text);line-height:1.2}
.stat .sub{font-size:11px;color:var(--muted);margin-top:3px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);overflow-x:auto;overflow-y:hidden;margin-bottom:14px;min-width:0}
.card-head{padding:9px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.6px}
.card-head .va{font-size:11px;text-transform:none;font-weight:400;color:var(--accent);cursor:pointer}
.card-head .va:hover{text-decoration:underline}
.tbl{width:100%;min-width:0;border-collapse:collapse;table-layout:fixed}
.tbl th{padding:6px 14px;text-align:left;font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border);white-space:nowrap;background:var(--surface)}
.tbl td{padding:7px 14px;border-bottom:1px solid var(--border);font-family:var(--mono);font-size:12px;vertical-align:middle;word-break:break-word;overflow-wrap:anywhere}
.tbl tr:last-child td{border-bottom:none}
.tbl tbody tr[data-nav]:hover td{background:var(--surface2);cursor:pointer}
.tbl tbody tr:not([data-nav]):hover td{background:var(--surface2)}
.empty{padding:24px 14px;text-align:center;color:var(--muted);font-family:sans-serif;font-size:13px}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
@media(max-width:768px){.two-col{grid-template-columns:1fr}}
@media(max-width:960px){
  .stats{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:720px){
  .topbar{padding:10px 12px;gap:10px}
  .logo{flex:1 1 auto;min-width:0}
  .search-box{order:3;flex:1 1 100%;max-width:none;width:100%}
  #app{padding:12px 10px}
  .stats{grid-template-columns:1fr}
  .two-col{grid-template-columns:1fr}
  .card{margin-bottom:12px}
  .card-head{padding:10px 12px}
  .tbl th,.tbl td{padding:7px 10px;font-size:11px}
  .breadcrumb{align-items:flex-start}
  .drow{flex-direction:column;gap:4px;padding:10px 12px}
  .dkey{width:auto;padding-top:0;font-size:11px}
  .dval{font-size:11px;line-height:1.45}
  .netgrid{grid-template-columns:1fr}
  .netitem{border-right:none;border-bottom:1px solid var(--border)}
  .netitem:last-child{border-bottom:none}
  .pnbtn{padding:5px 8px}
  .badge{white-space:normal}
  .card{overflow:visible}
  .tbl{display:block;table-layout:auto}
  .tbl thead{display:none}
  .tbl tbody{display:block}
  .tbl tr{display:block;border-bottom:1px solid var(--border);padding:10px 0;margin:0 12px}
  .tbl tr:last-child{border-bottom:none}
  .tbl td{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;border-bottom:none;padding:5px 0;font-size:11px;white-space:normal}
  .tbl td::before{content:attr(data-label);color:var(--muted);font-size:10px;line-height:1.35;text-transform:uppercase;letter-spacing:.4px;flex:0 0 42%;max-width:42%;padding-right:10px}
  .tbl td.empty{display:block}
  .tbl td.empty::before{content:none}
  .tbl td > *{max-width:100%}
}
@media(max-width:480px){
  body{font-size:13px}
  .search-box input{font-size:13px}
  .stat .val{font-size:18px}
  .stat,.netitem{padding:12px 12px}
  .tbl{font-size:11px}
  .tbl th{font-size:9px}
  .tbl td{font-size:10px}
  .empty{padding:18px 12px}
  .hl,.dval,.netitem .val{font-size:11px}
}
.badge{display:inline-block;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:600;font-family:var(--mono);white-space:nowrap}
.b-green {background:#1f3a2a;color:var(--green)}
.b-red   {background:#3a1f1f;color:var(--red)}
.b-gray  {background:#21262d;color:var(--muted)}
.b-blue  {background:#162035;color:var(--accent)}
.b-orange{background:#2a1500;color:var(--orange)}
.b-yellow{background:#241900;color:var(--yellow)}
.b-purple{background:#1a1430;color:var(--purple)}
.hl{color:var(--accent);font-family:var(--mono);font-size:12px;cursor:pointer}
.hl:hover{text-decoration:underline}
.cpbtn{background:none;border:1px solid var(--border2);border-radius:3px;color:var(--muted);cursor:pointer;padding:1px 6px;font-size:10px;transition:color .1s,border-color .1s;flex-shrink:0}
.cpbtn:hover{color:var(--accent);border-color:var(--accent)}
.cpbtn.ok{color:var(--green);border-color:var(--green)}
.breadcrumb{font-size:12px;color:var(--muted);margin-bottom:16px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.breadcrumb a{color:var(--accent);cursor:pointer}
.breadcrumb a:hover{text-decoration:underline}
.breadcrumb .sep{color:var(--muted2)}
.drow{display:flex;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border);align-items:flex-start}
.drow:last-child{border-bottom:none}
.dkey{color:var(--muted);font-size:12px;width:130px;flex-shrink:0;padding-top:1px}
.dval{font-family:var(--mono);font-size:12px;color:var(--text);word-break:break-all;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pnbtn{background:none;border:1px solid var(--border2);border-radius:4px;color:var(--muted);cursor:pointer;padding:3px 10px;font-size:11px}
.pnbtn:hover{border-color:var(--accent);color:var(--accent)}
.netgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.netitem{padding:12px 16px;border-right:1px solid var(--border)}
.netitem:last-child{border-right:none}
.netitem .lbl{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
.netitem .val{font-family:var(--mono);font-size:13px}
.loading{padding:48px;text-align:center;color:var(--muted);font-size:13px}
.err{background:#2a1215;border:1px solid var(--red);border-radius:var(--r);padding:12px 16px;color:var(--red);font-size:13px}
.mp-badge{display:inline-block;background:#1a2010;color:#9ae086;border-radius:10px;padding:1px 8px;font-size:11px;font-family:var(--mono);margin-left:6px;font-weight:600}
</style>
</head>
<body>

<div class="topbar">
  <a class="logo" data-nav="/">
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 1.5L17.5 5.5V14.5L10 18.5L2.5 14.5V5.5Z" stroke="#4f8ef7" stroke-width="1.4" fill="rgba(79,142,247,.08)"/>
      <circle cx="10" cy="10" r="2.5" fill="#4f8ef7"/>
    </svg>
    Quantix Explorer
  </a>
  <div class="search-box">
    <button id="search-btn" title="Search">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
    </button>
    <input id="gsearch" placeholder="Address / Tx hash / Block height\u2026" spellcheck="false" autocomplete="off">
  </div>
  <div class="live" id="live-dot"></div>
</div>

<div id="app"><div class="loading">Loading\u2026</div></div>

<script>
async function rpc(method, params) {
  params = params || [];
  var r = await fetch('/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: method, params: params }),
  });
  var j = await r.json();
  if (j.error) throw new Error(j.error.message || String(j.error));
  return j.result;
}
function fmtQtx(s) {
  if (!s || s === '0') return '0 QTX';
  try {
    var n = BigInt(s), E = 1000000000000000000n;
    var whole = n / E;
    var frac = (n % E).toString().padStart(18, '0').replace(/0+$/, '');
    return whole.toLocaleString() + (frac ? '.' + frac.slice(0, 6) : '') + ' QTX';
  } catch(e) { return s + ' QTX'; }
}
function fmtQtxCompact(s) {
  if (!s || s === '0') return '0';
  try {
    var n = BigInt(s), E = 1000000000000000000n;
    var whole = n / E;
    var frac = (n % E).toString().padStart(18, '0').replace(/0+$/, '');
    return whole.toLocaleString() + (frac ? '.' + frac.slice(0, 4) : '');
  } catch(e) { return String(s); }
}
function tblCell(label, content) {
  return '<td data-label="'+esc(label)+'">'+content+'</td>';
}
function fmtTime(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return '\u2014';
  try {
    return new Date(ts).toLocaleString();
  } catch(e) {
    return String(ts);
  }
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function truncAddr(s) { if (!s) return '\u2014'; return s.length > 18 ? s.slice(0,10)+'\u2026'+s.slice(-6) : s; }
function truncHash(s) { if (!s) return '\u2014'; return s.length > 18 ? s.slice(0,10)+'\u2026'+s.slice(-8) : s; }
function typeBadge(type) {
  var cls = {
    transfer:'b-blue',
    stake:'b-orange',
    unstake:'b-yellow',
    validator_register:'b-purple',
    validator_unregister:'b-gray',
    contract_deploy:'b-green',
    contract_call:'b-purple'
  };
  return '<span class="badge '+(cls[type]||'b-gray')+'">'+esc(type)+'</span>';
}
function statusBadge(ok) {
  return ok ? '<span class="badge b-green">committed</span>' : '<span class="badge b-gray">pending</span>';
}
function valBadge(v) {
  if (v.slashed) return '<span class="badge b-red">slashed</span>';
  if (v.active)  return '<span class="badge b-green">active</span>';
  return '<span class="badge b-gray">pending</span>';
}
function navLink(path, text, cls) {
  return '<a class="'+(cls||'hl')+'" data-nav="'+esc(path)+'">'+text+'</a>';
}
function isContractAddress(addr) {
  return /^qtxContract/i.test(String(addr || ''));
}
function addrLink(addr, display) {
  if (!addr) return '\u2014';
  return navLink((isContractAddress(addr)?'/contract/':'/address/')+addr, esc(display||truncAddr(addr)));
}
function blockLink(h) { return navLink('/block/'+h, '#'+h); }
function txLink(hash, display) {
  if (!hash) return '\u2014';
  return navLink('/tx/'+hash, esc(display||truncHash(hash)));
}
function copyBtn(text) {
  return '<button class="cpbtn" data-copy="'+esc(text)+'">copy</button>';
}
function drow(key, val) {
  return '<div class="drow"><div class="dkey">'+key+'</div><div class="dval">'+val+'</div></div>';
}
document.addEventListener('click', function(e) {
  var cp = e.target.closest('[data-copy]');
  if (cp) {
    e.preventDefault();
    navigator.clipboard.writeText(cp.dataset.copy).then(function() {
      cp.textContent = 'copied!'; cp.classList.add('ok');
      setTimeout(function() { cp.textContent = 'copy'; cp.classList.remove('ok'); }, 1500);
    });
    return;
  }
  var cf = e.target.closest('[data-contract-filter]');
  if (cf) {
    e.preventDefault();
    var addr = String(cf.dataset.addr || '');
    var txPage = Number(cf.dataset.txPage || 0) || 0;
    var evPage = Number(cf.dataset.evPage || 0) || 0;
    var pageSize = Number(cf.dataset.pageSize || 25) || 25;
    var input = document.getElementById('contract-event-filter');
    var eventFilter = input ? String(input.value || '').trim() : '';
    navigate(buildContractPath(addr, txPage, evPage, eventFilter, pageSize));
    return;
  }
  var cc = e.target.closest('[data-contract-clear]');
  if (cc) {
    e.preventDefault();
    var cAddr = String(cc.dataset.addr || '');
    var cTxPage = Number(cc.dataset.txPage || 0) || 0;
    var cPageSize = Number(cc.dataset.pageSize || 25) || 25;
    navigate(buildContractPath(cAddr, cTxPage, 0, '', cPageSize));
    return;
  }
  var nv = e.target.closest('[data-nav]');
  if (nv) { e.preventDefault(); navigate(nv.dataset.nav); }
});
document.addEventListener('keydown', function(e) {
  var target = e.target;
  if (!target || target.id !== 'contract-event-filter') return;
  if (e.key !== 'Enter') return;
  e.preventDefault();
  var addr = String(target.dataset.addr || '');
  var txPage = Number(target.dataset.txPage || 0) || 0;
  var pageSize = Number(target.dataset.pageSize || 25) || 25;
  var eventFilter = String(target.value || '').trim();
  navigate(buildContractPath(addr, txPage, 0, eventFilter, pageSize));
});
function doSearch() {
  var q = document.getElementById('gsearch').value.trim();
  if (!q) return;
  if (/^[0-9]+$/.test(q))  { navigate('/block/'+q); return; }
  if (isContractAddress(q)) { navigate('/contract/'+q); return; }
  if (/^qtx/i.test(q))  { navigate('/address/'+q); return; }
  navigate('/tx/'+q);
}
document.getElementById('gsearch').addEventListener('keydown', function(e) { if (e.key==='Enter') doSearch(); });
document.getElementById('search-btn').addEventListener('click', doSearch);
var _timer = null;
function stopTimer() { if (_timer) { clearInterval(_timer); _timer = null; } }
function navigate(path) { location.hash = '#'+path; }
function buildContractPath(addr, txPage, evPage, eventFilter, pageSize) {
  var q = [];
  if (txPage > 0) q.push('txPage=' + txPage);
  if (evPage > 0) q.push('evPage=' + evPage);
  if (eventFilter) q.push('event=' + encodeURIComponent(eventFilter));
  if (pageSize && Number(pageSize) !== 25) q.push('size=' + Number(pageSize));
  return '/contract/' + addr + (q.length ? '?' + q.join('&') : '');
}
function parseQuery(qs) {
  var out = {};
  if (!qs) return out;
  var body = qs.charAt(0) === '?' ? qs.slice(1) : qs;
  if (!body) return out;
  var parts = body.split('&');
  for (var i=0; i<parts.length; i++) {
    var kv = parts[i].split('=');
    var k = decodeURIComponent(kv[0] || '');
    if (!k) continue;
    out[k] = decodeURIComponent(kv[1] || '');
  }
  return out;
}
function route() {
  stopTimer();
  var full = location.hash.replace(/^#/,'') || '/';
  var qpos = full.indexOf('?');
  var path = qpos >= 0 ? full.slice(0, qpos) : full;
  var query = qpos >= 0 ? parseQuery(full.slice(qpos)) : {};
  document.getElementById('app').innerHTML = '<div class="loading">Loading\u2026</div>';
  if (path==='/'||path==='')           renderHome();
  else if (path.startsWith('/block/')) renderBlock(Number(path.slice(7)));
  else if (path.startsWith('/tx/'))    renderTx(path.slice(4), query);
  else if (path.startsWith('/contract/')) renderContract(path.slice(10), query);
  else if (path.startsWith('/address/')) renderAddress(path.slice(9));
  else if (path==='/validators')       renderValidators();
  else document.getElementById('app').innerHTML = '<div class="err">Not found: '+esc(path)+'</div>';
}
window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);
function dotOn()  { var d=document.getElementById('live-dot'); if(d) d.className='live on'; }
function dotOff() { var d=document.getElementById('live-dot'); if(d) d.className='live'; }

// ── HOME ──────────────────────────────────────────────────────────────────────
async function renderHome() {
  async function load() {
    dotOn();
    try {
      var res = await Promise.all([
        rpc('qtx_getChainInfo'),
        rpc('qtx_getLatestBlock'),
        rpc('qtx_getValidators'),
        rpc('qtx_getMempool'),
        rpc('qtx_getPeers'),
        rpc('qtx_getRewardHistory', [0, 999999999]).catch(function(){ return []; }),
      ]);
      var info=res[0], latest=res[1], validators=res[2], mempool=res[3], peers=res[4], rewardHistory=res[5];
      var h = latest.height;
      var bf = [];
      for (var i=Math.max(0,h-9); i<=h; i++) bf.push(rpc('qtx_getBlock',[i]).catch(function(){return null;}));
      var blocks = (await Promise.all(bf)).filter(Boolean).reverse();
      var activeV = validators.filter(function(v){return v.active&&!v.slashed;}).length;
      var recentTxs = [];
      for (var bi=0;bi<blocks.length;bi++) {
        var btxs=blocks[bi].txs||[];
        for (var ti=0;ti<btxs.length;ti++) recentTxs.push({tx:btxs[ti],bh:blocks[bi].height});
      }
      recentTxs = recentTxs.slice(0,10);
      var rewardByHeight = {};
      if (Array.isArray(rewardHistory)) {
        for (var ri=0; ri<rewardHistory.length; ri++) {
          var rr = rewardHistory[ri];
          if (rr && typeof rr.height === 'number') rewardByHeight[rr.height] = rr;
        }
      }
      document.getElementById('app').innerHTML = buildHome(info,h,blocks,recentTxs,validators,activeV,mempool,peers,rewardByHeight);
    } catch(e) {
      document.getElementById('app').innerHTML = '<div class="err">Failed to connect: '+esc(e.message)+'</div>';
    } finally { dotOff(); }
  }
  await load();
  _timer = setInterval(load, 4000);
}

function buildHome(info, h, blocks, recentTxs, validators, activeV, mempool, peers, rewardByHeight) {
  var rewardCfg = info && info.rewards ? info.rewards : null;
  var latestReward = rewardByHeight && rewardByHeight[h] ? rewardByHeight[h] : null;
  var latestBurn = latestReward ? fmtQtxCompact(latestReward.burnedFees) : '—';
  var latestPool = latestReward ? fmtQtxCompact(latestReward.validatorFeePool) : '—';
  var stats = '<div class="stats">'
    +'<div class="stat"><div class="lbl">Block Height</div><div class="val">'+h.toLocaleString()+'</div><div class="sub">latest committed</div></div>'
    +'<div class="stat"><div class="lbl">Active Validators</div><div class="val">'+activeV+'</div><div class="sub">of '+validators.length+' registered</div></div>'
    +'<div class="stat"><div class="lbl">Mempool</div><div class="val">'+mempool.length+'</div><div class="sub">pending txs</div></div>'
    +'<div class="stat"><div class="lbl">Block Interval</div><div class="val">'+(info?info.blockIntervalMs:4000)+'ms</div><div class="sub">'+esc(info?info.chainId:'')+'</div></div>'
    +'<div class="stat"><div class="lbl">Peers</div><div class="val">'+peers.length+'</div><div class="sub">connected nodes</div></div>'
    +'<div class="stat"><div class="lbl">Reward Mode</div><div class="val">'+esc(rewardCfg && rewardCfg.enabled ? String(rewardCfg.mode || 'enabled') : 'off')+'</div><div class="sub">block '+esc(fmtQtxCompact(rewardCfg ? rewardCfg.blockReward : '0'))+' QTX</div></div>'
    +'<div class="stat"><div class="lbl">Latest Fee Pool</div><div class="val">'+esc(latestPool)+'</div><div class="sub">burned '+esc(latestBurn)+' QTX</div></div>'
    +'</div>';
  var blkRows='';
  if (!blocks.length) { blkRows='<tr><td colspan="5" class="empty">No blocks yet</td></tr>'; }
  else for (var i=0;i<blocks.length;i++) {
    var b=blocks[i];
    blkRows+='<tr data-nav="/block/'+b.height+'">'
      +tblCell('Height', blockLink(b.height))
      +tblCell('Time', '<span style="color:var(--muted);font-family:sans-serif">'+esc(fmtTime(b.timestamp))+'</span>')
      +tblCell('Proposer', addrLink(b.proposer))
      +tblCell('Txs', String(b.txCount))
      +tblCell('Status', statusBadge(b.committed))
      +tblCell('Reward Pool', rewardByHeight && rewardByHeight[b.height] ? fmtQtxCompact(rewardByHeight[b.height].validatorFeePool)+' QTX' : '<span style="color:var(--muted)">—</span>')
      +tblCell('Burned Fees', rewardByHeight && rewardByHeight[b.height] ? fmtQtxCompact(rewardByHeight[b.height].burnedFees)+' QTX' : '<span style="color:var(--muted)">—</span>')
      +tblCell('Hash', '<span style="color:var(--muted);font-size:11px">'+esc(truncHash(b.hash))+'</span>')
      +'</tr>';
  }
  var txRows='';
  if (!recentTxs.length) { txRows='<tr><td colspan="5" class="empty">No transactions yet</td></tr>'; }
  else for (var j=0;j<recentTxs.length;j++) {
    var t=recentTxs[j].tx;
    txRows+='<tr data-nav="/tx/'+esc(t.hash)+'">'
      +tblCell('Tx Hash', txLink(t.hash))
      +tblCell('Time', '<span style="color:var(--muted);font-family:sans-serif">'+esc(fmtTime(t.timestamp))+'</span>')
      +tblCell('Type', typeBadge(t.type))
      +tblCell('From', addrLink(t.from))
      +tblCell('To', t.to?addrLink(t.to):t.validatorId?addrLink(t.validatorId):t.contractAddress?addrLink(t.contractAddress):'\u2014')
      +tblCell('Amount', fmtQtx(t.amount))
      +'</tr>';
  }
  var valRows='';
  if (!validators.length) { valRows='<tr><td colspan="4" class="empty">No validators registered</td></tr>'; }
  else for (var k=0;k<validators.length;k++) {
    var v=validators[k];
    valRows+='<tr data-nav="/address/'+esc(v.id)+'">'
      +tblCell('Address', addrLink(v.id,truncAddr(v.id)))
      +tblCell('Stake', fmtQtx(v.stake))
      +tblCell('Cumulative Rewards', fmtQtx(v.cumulativeRewards || '0'))
      +tblCell('Status', valBadge(v))
      +tblCell('Missed Blocks', String(v.missedBlocks))
      +'</tr>';
  }
  var mpRows='';
  if (!mempool.length) { mpRows='<tr><td colspan="5" class="empty">Empty \u2014 no pending transactions</td></tr>'; }
  else {
    var mp8=mempool.slice(0,8);
    for (var m=0;m<mp8.length;m++) {
      var mt=mp8[m];
      mpRows+='<tr>'
        +tblCell('Tx Hash', txLink(mt.hash))
        +tblCell('Type', typeBadge(mt.type))
        +tblCell('From', addrLink(mt.from))
        +tblCell('Amount', fmtQtx(mt.amount))
        +tblCell('Nonce', String(mt.nonce))
        +'</tr>';
    }
    if (mempool.length>8) mpRows+='<tr><td colspan="5" class="empty">+ '+(mempool.length-8)+' more\u2026</td></tr>';
  }
  var peerRows='';
  if (!peers.length) { peerRows='<tr><td colspan="2" class="empty">No peers connected</td></tr>'; }
  else for (var p=0;p<peers.length;p++) {
    peerRows+='<tr>'
      +tblCell('Node ID', esc(peers[p].id))
      +tblCell('Endpoint', '<span style="color:var(--muted)">'+esc(peers[p].endpoint)+'</span>')
      +'</tr>';
  }
  return stats
    +'<div class="two-col">'
    +'<div class="card"><div class="card-head">Recent Blocks</div>'
    +'<table class="tbl"><thead><tr><th>Height</th><th>Time</th><th>Proposer</th><th>Txs</th><th>Status</th><th>Reward Pool</th><th>Burned Fees</th><th>Hash</th></tr></thead>'
    +'<tbody>'+blkRows+'</tbody></table></div>'
    +'<div class="card"><div class="card-head">Recent Transactions</div>'
    +'<table class="tbl"><thead><tr><th>Tx Hash</th><th>Time</th><th>Type</th><th>From</th><th>To</th><th>Amount</th></tr></thead>'
    +'<tbody>'+txRows+'</tbody></table></div>'
    +'</div>'
    +'<div class="card"><div class="card-head">Validators'
    +'<a class="va" data-nav="/validators">View all \u2197</a></div>'
    +'<table class="tbl"><thead><tr><th>Address</th><th>Stake</th><th>Cumulative Rewards</th><th>Status</th><th>Missed Blocks</th></tr></thead>'
    +'<tbody>'+valRows+'</tbody></table></div>'
    +'<div class="card"><div class="card-head">Mempool'
    +'<span class="mp-badge">'+mempool.length+' pending</span></div>'
    +'<table class="tbl"><thead><tr><th>Tx Hash</th><th>Type</th><th>From</th><th>Amount</th><th>Nonce</th></tr></thead>'
    +'<tbody>'+mpRows+'</tbody></table></div>'
    +'<div class="card"><div class="card-head">Network</div><div class="netgrid">'
    +'<div class="netitem"><div class="lbl">Chain ID</div><div class="val">'+esc(info?info.chainId:'\u2014')+'</div></div>'
    +'<div class="netitem"><div class="lbl">Name</div><div class="val">'+esc(info?info.name:'\u2014')+'</div></div>'
    +'<div class="netitem"><div class="lbl">Consensus</div><div class="val">'+esc(info?info.consensus:'\u2014')+'</div></div>'
    +'<div class="netitem"><div class="lbl">Token</div><div class="val">'+esc(info?info.nativeDenom:'\u2014')+'</div></div>'
    +'<div class="netitem"><div class="lbl">Node ID</div><div class="val">'+esc(info?info.nodeId:'\u2014')+'</div></div>'
    +'</div></div>'
    +'<div class="card"><div class="card-head">Peers</div>'
    +'<table class="tbl"><thead><tr><th>Node ID</th><th>Endpoint</th></tr></thead>'
    +'<tbody>'+peerRows+'</tbody></table></div>';
}

// ── BLOCK DETAIL ──────────────────────────────────────────────────────────────
async function renderBlock(height) {
  try {
    var latest = await rpc('qtx_getLatestBlock');
    var block  = await rpc('qtx_getBlock',[height]);
    var reward = await rpc('qtx_getRewardsByHeight', [height]).catch(function(){ return null; });
    var maxH   = latest.height;
    var txRows='';
    if (!block.txs||!block.txs.length) {
      txRows='<tr><td colspan="8" class="empty">No transactions in this block</td></tr>';
    } else {
      for (var i=0;i<block.txs.length;i++) {
        var t=block.txs[i];
        txRows+='<tr data-nav="/tx/'+esc(t.hash)+'">'
          +tblCell('Tx Hash', txLink(t.hash))
          +tblCell('Time', '<span style="color:var(--muted);font-family:sans-serif">'+esc(fmtTime(t.timestamp))+'</span>')
          +tblCell('Type', typeBadge(t.type))
          +tblCell('From', addrLink(t.from))
          +tblCell('To / Validator', t.to?addrLink(t.to):t.validatorId?addrLink(t.validatorId):t.contractAddress?addrLink(t.contractAddress):'\u2014')
          +tblCell('Amount', fmtQtx(t.amount))
          +tblCell('Fee', fmtQtx(t.fee))
          +tblCell('Nonce', String(t.nonce))
          +'</tr>';
      }
    }
    var prevBtn = height>0    ? '<button class="pnbtn" data-nav="/block/'+(height-1)+'">\u2190 Prev</button>' : '';
    var nextBtn = height<maxH ? '<button class="pnbtn" data-nav="/block/'+(height+1)+'">Next \u2192</button>' : '';
    document.getElementById('app').innerHTML =
      '<div class="breadcrumb">'+navLink('/','Home')+'<span class="sep">\u203a</span><span>Block #'+height+'</span>'
      +'<span style="margin-left:auto;display:flex;gap:6px">'+prevBtn+nextBtn+'</span></div>'
      +'<div class="card"><div class="card-head">Block #'+height+'&nbsp;&nbsp;'+statusBadge(block.committed)+'</div>'
      +drow('Height', String(block.height))
      +drow('Hash', '<span class="hl">'+esc(block.hash)+'</span>'+copyBtn(block.hash))
      +drow('Parent Hash', height>0
          ? navLink('/block/'+(height-1),esc(block.parentHash),'hl')+copyBtn(block.parentHash)
          : '<span style="color:var(--muted)">genesis</span>')
      +drow('Proposer', addrLink(block.proposer,block.proposer)+copyBtn(block.proposer))
      +drow('Timestamp', esc(fmtTime(block.timestamp)))
      +drow('Transactions', String(block.txCount))
      +drow('Status', statusBadge(block.committed))
      +(reward ? drow('Reward Proposer', addrLink(reward.proposerId, reward.proposerId)+copyBtn(reward.proposerId)) : '')
      +(reward ? drow('Total Fees', fmtQtx(reward.totalFees)) : '')
      +(reward ? drow('Validator Fee Pool', fmtQtx(reward.validatorFeePool)) : '')
      +(reward ? drow('Burned Fees', fmtQtx(reward.burnedFees)) : '')
      +(reward ? drow('Fixed Block Reward', fmtQtx(reward.blockReward)) : '')
      +'</div>'
      +'<div class="card"><div class="card-head">Transactions ('+block.txCount+')</div>'
      +'<table class="tbl"><thead><tr>'
      +'<th>Tx Hash</th><th>Time</th><th>Type</th><th>From</th><th>To / Validator</th><th>Amount</th><th>Fee</th><th>Nonce</th>'
      +'</tr></thead><tbody>'+txRows+'</tbody></table></div>';
  } catch(e) {
    document.getElementById('app').innerHTML =
      '<div class="breadcrumb">'+navLink('/','Home')+'<span class="sep">\u203a</span><span>Block #'+height+'</span></div>'
      +'<div class="err">'+esc(e.message)+'</div>';
  }
}

// ── TX DETAIL ─────────────────────────────────────────────────────────────────
async function renderTx(hash, query) {
  try {
    var t = await rpc('qtx_getTransaction',[hash]);
    var receipt = null;
    var eventContext = query && query.event ? String(query.event) : '';
    var contractContext = query && query.contract ? String(query.contract) : '';
    if (t.type === 'contract_deploy' || t.type === 'contract_call') {
      try { receipt = await rpc('qtx_getReceipt', [t.hash]); } catch(e) {}
    }
    document.getElementById('app').innerHTML =
      '<div class="breadcrumb">'+navLink('/','Home')+'<span class="sep">\u203a</span><span>Transaction</span></div>'
      +'<div class="card"><div class="card-head">Transaction Detail&nbsp;&nbsp;'
      +(t.status==='committed'?statusBadge(true):'<span class="badge b-gray">pending</span>')+'</div>'
      +drow('Tx Hash', '<span class="hl">'+esc(t.hash)+'</span>'+copyBtn(t.hash))
      +drow('Status', t.status==='committed'?statusBadge(true):'<span class="badge b-gray">pending</span>')
      +drow('Block', t.blockHeight!==null?blockLink(t.blockHeight):'\u2014')
      +drow('Block Hash', t.blockHash?'<span class="hl">'+esc(t.blockHash)+'</span>'+copyBtn(t.blockHash):'\u2014')
      +drow('Type', typeBadge(t.type))
      +drow('From', addrLink(t.from,t.from)+copyBtn(t.from))
      +(t.to ? drow('To', addrLink(t.to,t.to)+copyBtn(t.to)) : '')
      +(t.validatorId ? drow('Validator ID', addrLink(t.validatorId,t.validatorId)+copyBtn(t.validatorId)) : '')
        +(t.contractAddress ? drow('Contract', addrLink(t.contractAddress,t.contractAddress)+copyBtn(t.contractAddress)) : '')
        +(t.contractAddress ? drow('Contract Page', navLink('/contract/'+t.contractAddress, 'Open Contract Detail')) : '')
        +(eventContext ? drow('Event Context', '<span class="badge b-blue">'+esc(eventContext)+'</span>') : '')
        +(contractContext ? drow('Back To Contract', navLink('/contract/'+contractContext+(eventContext?('?event='+encodeURIComponent(eventContext)):'') , 'Open Filtered Contract View')) : '')
        +(t.method ? drow('Method', '<span class="hl">'+esc(t.method)+'</span>') : '')
      +drow('Timestamp', esc(fmtTime(t.timestamp)))
      +drow('Amount', fmtQtx(t.amount))
      +drow('Fee', fmtQtx(t.fee))
      +drow('Nonce', String(t.nonce))
        +(receipt ? drow('Receipt Status', receipt.success ? '<span class="badge b-green">success</span>' : '<span class="badge b-red">failed</span>') : '')
        +(receipt ? drow('Gas Used', String(receipt.gasUsed)) : '')
        +(receipt && receipt.error ? drow('Execution Error', '<span style="color:var(--red)">'+esc(receipt.error)+'</span>') : '')
      +'</div>';
  } catch(e) {
    document.getElementById('app').innerHTML =
      '<div class="breadcrumb">'+navLink('/','Home')+'<span class="sep">\u203a</span><span>Transaction</span></div>'
      +'<div class="err">'+esc(e.message)+'</div>';
  }
}

// ── ADDRESS DETAIL ────────────────────────────────────────────────────────────
async function renderAddress(addr) {
  try {
    var isContract = /^qtxContract/i.test(addr);
    var res = await Promise.all([
      rpc('qtx_getBalance',[addr]),
      rpc('qtx_getValidators'),
      rpc('qtx_getLatestBlock'),
    ]);
    var acc=res[0], validators=res[1], latest=res[2];
    var h = latest.height;
    var validator = null;
    for (var vi=0;vi<validators.length;vi++) {
      if (validators[vi].id===addr) { validator=validators[vi]; break; }
    }
    var rewardSummary = null;
    if (validator) {
      rewardSummary = await rpc('qtx_getValidatorRewards', [addr]).catch(function(){ return null; });
    }
    var fetches=[];
    for (var i=Math.max(0,h-49);i<=h;i++) fetches.push(rpc('qtx_getBlock',[i]).catch(function(){return null;}));
    var blocks=(await Promise.all(fetches)).filter(Boolean);
    var history=[];
    for (var bi=0;bi<blocks.length;bi++) {
      var txs=blocks[bi].txs||[];
      for (var ti=0;ti<txs.length;ti++) {
        var tx=txs[ti];
        if (tx.from===addr||tx.to===addr||tx.validatorId===addr||tx.contractAddress===addr) history.push({tx:tx,bh:blocks[bi].height});
      }
    }
    history.reverse();

    var contractMeta = null;
    var contractStorage = null;
    var contractEvents = [];
    var contractTxs = [];
    if (isContract) {
      try { contractMeta = await rpc('qtx_getCode', [addr]); } catch(e) {}
      try { contractStorage = await rpc('qtx_getStorage', [addr]); } catch(e) {}
      try { contractEvents = await rpc('qtx_getEvents', [addr, Math.max(0, h-200), h, '']); } catch(e) {}
      try { contractTxs = await rpc('qtx_getContractTransactions', [addr, Math.max(0, h-200), h]); } catch(e) {}
    }

    var txRows='';
    if (!history.length) {
      txRows='<tr><td colspan="7" class="empty">No transactions found in last 50 blocks</td></tr>';
    } else {
      for (var hi=0;hi<history.length;hi++) {
        var item=history[hi];
        var t=item.tx;
        var isOut=t.from===addr;
        var dir=isOut?'<span style="color:var(--red);font-weight:600">OUT</span>'
                     :'<span style="color:var(--green);font-weight:600">IN</span>';
        var cp=isOut?(t.to?addrLink(t.to):t.validatorId?addrLink(t.validatorId):t.contractAddress?addrLink(t.contractAddress):'\u2014'):addrLink(t.from);
        txRows+='<tr data-nav="/tx/'+esc(t.hash)+'">'
          +tblCell('Tx Hash', txLink(t.hash))
          +tblCell('Block', blockLink(item.bh))
          +tblCell('Time', '<span style="color:var(--muted);font-family:sans-serif">'+esc(fmtTime(t.timestamp))+'</span>')
          +tblCell('Type', typeBadge(t.type))
          +tblCell('Dir', dir)
          +tblCell('Counterpart', cp)
          +tblCell('Amount', fmtQtx(t.amount))
          +'</tr>';
      }
    }

    var contractCard = '';
    if (isContract) {
      var storageCount = contractStorage && contractStorage.storage ? Object.keys(contractStorage.storage).length : 0;
      var txCount = Array.isArray(contractTxs) ? contractTxs.length : 0;
      var eventCount = Array.isArray(contractEvents) ? contractEvents.length : 0;
      var eventRows = '';
      if (!eventCount) {
        eventRows = '<tr><td colspan="4" class="empty">No events in recent range</td></tr>';
      } else {
        var ev = contractEvents.slice(0, 20);
        for (var ei=0; ei<ev.length; ei++) {
          var eitem = ev[ei];
          eventRows += '<tr>'
            +tblCell('Tx Hash', txLink(eitem.txHash))
            +tblCell('Name', esc(eitem.name))
            +tblCell('Block', String(eitem.blockHeight))
            +tblCell('Data', '<span style="color:var(--muted)">'+esc(eitem.data)+'</span>')
            +'</tr>';
        }
      }
      contractCard =
        '<div class="card"><div class="card-head">Contract Details</div>'
        +(contractMeta ? drow('Owner', addrLink(contractMeta.owner, contractMeta.owner)+copyBtn(contractMeta.owner)) : '')
        +(contractMeta ? drow('Code Hash', '<span class="hl">'+esc(contractMeta.codeHash)+'</span>'+copyBtn(contractMeta.codeHash)) : '')
        +(contractMeta ? drow('Deployed Height', String(contractMeta.deployedAtHeight)) : '')
        +drow('Storage Keys', String(storageCount))
        +drow('Recent Contract TXs', String(txCount))
        +drow('Recent Events', String(eventCount))
        +'</div>'
        +'<div class="card"><div class="card-head">Contract Events'
        +'<span style="font-weight:400;text-transform:none;font-size:11px;margin-left:6px;color:var(--muted)">last 200 blocks</span></div>'
        +'<table class="tbl"><thead><tr><th>Tx Hash</th><th>Name</th><th>Block</th><th>Data</th></tr></thead><tbody>'+eventRows+'</tbody></table></div>';
    }

    document.getElementById('app').innerHTML =
      '<div class="breadcrumb">'+navLink('/','Home')+'<span class="sep">\u203a</span><span>Address</span></div>'
      +'<div class="card"><div class="card-head">Address</div>'
      +drow('Address', '<span class="hl" style="word-break:break-all">'+esc(addr)+'</span>'+copyBtn(addr))
      +drow('Balance', '<strong>'+fmtQtx(acc.balance)+'</strong>')
      +drow('Staked', fmtQtx(acc.staked))
      +drow('Nonce', String(acc.nonce))
      +(validator?drow('Validator',valBadge(validator)+'&nbsp;&nbsp;missed: '+validator.missedBlocks):'')
      +(rewardSummary?drow('Cumulative Rewards', '<strong>'+fmtQtx(rewardSummary.cumulativeRewards)+'</strong>'):'')
      +(rewardSummary?drow('Last Reward Height', String(rewardSummary.lastRewardHeight)):'')
      +(isContract ? drow('Contract View', navLink('/contract/'+addr, 'Open Contract Page')) : '')
      +'</div>'
      +contractCard
      +'<div class="card"><div class="card-head">Transaction History'
      +'<span style="font-weight:400;text-transform:none;font-size:11px;margin-left:6px;color:var(--muted)">last 50 blocks</span></div>'
      +'<table class="tbl"><thead><tr>'
      +'<th>Tx Hash</th><th>Block</th><th>Time</th><th>Type</th><th>Dir</th><th>Counterpart</th><th>Amount</th>'
      +'</tr></thead><tbody>'+txRows+'</tbody></table></div>';
  } catch(e) {
    document.getElementById('app').innerHTML =
      '<div class="breadcrumb">'+navLink('/','Home')+'<span class="sep">\u203a</span><span>Address</span></div>'
      +'<div class="err">'+esc(e.message)+'</div>';
  }
}

// ── CONTRACT DETAIL ───────────────────────────────────────────────────────────
async function renderContract(addr, query) {
  try {
    if (!isContractAddress(addr)) {
      document.getElementById('app').innerHTML =
        '<div class="breadcrumb">'+navLink('/','Home')+'<span class="sep">\u203a</span><span>Contract</span></div>'
        +'<div class="err">Invalid contract address</div>';
      return;
    }

    var txPageReq = Math.max(0, Number(query.txPage || 0) || 0);
    var evPageReq = Math.max(0, Number(query.evPage || 0) || 0);
    var eventFilter = String(query.event || '').trim();
    var size = Number(query.size || 25) || 25;
    if ([10, 25, 50, 100].indexOf(size) < 0) size = 25;
    var lookback = 1000;
    var res = await Promise.all([
      rpc('qtx_getLatestBlock'),
      rpc('qtx_getCode', [addr]),
      rpc('qtx_getStorage', [addr]).catch(function(){ return { storage: {} }; }),
      rpc('qtx_getBalance', [addr]).catch(function(){ return { balance:'0', staked:'0', nonce:0 }; })
    ]);
    var latest = res[0], meta = res[1], storageRes = res[2], balance = res[3];
    var h = latest.height;
    var fromHeight = Math.max(0, h - lookback);

    var txs = await rpc('qtx_getContractTransactions', [addr, fromHeight, h]).catch(function(){ return []; });
    var events = await rpc('qtx_getEvents', [addr, fromHeight, h, eventFilter]).catch(function(){ return []; });

    var totalTx = txs.length;
    var totalEv = events.length;
    var txPages = Math.max(1, Math.ceil(totalTx / size));
    var evPages = Math.max(1, Math.ceil(totalEv / size));
    var txPage = Math.min(txPageReq, txPages - 1);
    var evPage = Math.min(evPageReq, evPages - 1);
    var txSlice = txs.slice(txPage * size, txPage * size + size);
    var evSlice = events.slice(evPage * size, evPage * size + size);

    var txRows = '';
    if (!txSlice.length) {
      txRows = '<tr><td colspan="6" class="empty">No contract transactions in selected range</td></tr>';
    } else {
      for (var i=0; i<txSlice.length; i++) {
        var t = txSlice[i];
        txRows += '<tr data-nav="/tx/'+esc(t.hash)+'">'
          +tblCell('Tx Hash', txLink(t.hash))
          +tblCell('Type', typeBadge(t.type))
          +tblCell('From', addrLink(t.from))
          +tblCell('Method', t.method ? '<span class="hl">'+esc(t.method)+'</span>' : '\u2014')
          +tblCell('Fee', fmtQtx(t.fee))
          +tblCell('Nonce', String(t.nonce))
          +'</tr>';
      }
    }

    var evRows = '';
    if (!evSlice.length) {
      evRows = '<tr><td colspan="5" class="empty">No contract events in selected range</td></tr>';
    } else {
      for (var j=0; j<evSlice.length; j++) {
        var ev = evSlice[j];
          evRows += '<tr>'
            +tblCell('Tx Hash', navLink('/tx/'+ev.txHash+'?event='+encodeURIComponent(ev.name)+'&contract='+encodeURIComponent(addr), esc(truncHash(ev.txHash))))
          +tblCell('Block', String(ev.blockHeight))
          +tblCell('Name', esc(ev.name))
          +tblCell('Data', esc(ev.data))
          +tblCell('Time', esc(fmtTime(ev.timestamp)))
          +'</tr>';
      }
    }

    var eventNames = [];
    for (var n=0; n<events.length; n++) {
      var en = events[n] && events[n].name ? String(events[n].name) : '';
      if (!en) continue;
      if (eventNames.indexOf(en) >= 0) continue;
      eventNames.push(en);
      if (eventNames.length >= 8) break;
    }
    var filterLinks = navLink(buildContractPath(addr, txPage, 0, '', size), 'All');
    for (var fi=0; fi<eventNames.length; fi++) {
      var name = eventNames[fi];
      if (eventFilter === name) {
        filterLinks += ' <span class="badge b-blue">'+esc(name)+'</span>';
      } else {
        filterLinks += ' ' + navLink(buildContractPath(addr, txPage, 0, name, size), esc(name));
      }
    }

    var sizeLinks = '';
    var sizeOpts = [10, 25, 50, 100];
    for (var si=0; si<sizeOpts.length; si++) {
      var s = sizeOpts[si];
      if (s === size) {
        sizeLinks += ' <span class="badge b-green">'+s+'</span>';
      } else {
        sizeLinks += ' ' + navLink(buildContractPath(addr, 0, 0, eventFilter, s), String(s));
      }
    }

    var keyRows = '';
    var keys = Object.keys((storageRes && storageRes.storage) ? storageRes.storage : {});
    if (!keys.length) {
      keyRows = '<tr><td colspan="2" class="empty">No storage keys</td></tr>';
    } else {
      var show = keys.slice(0, 50);
      for (var k=0; k<show.length; k++) {
        var key = show[k];
        keyRows += '<tr>'
          +tblCell('Key', '<span class="hl">'+esc(key)+'</span>')
          +tblCell('Value', '<span style="color:var(--muted)">'+esc(storageRes.storage[key])+'</span>')
          +'</tr>';
      }
      if (keys.length > 50) {
        keyRows += '<tr><td colspan="2" class="empty">+ '+(keys.length - 50)+' more keys</td></tr>';
      }
    }

    var txPrev = txPage > 0 ? navLink(buildContractPath(addr, txPage - 1, evPage, eventFilter, size), '← Prev TX') : '<span style="color:var(--muted)">← Prev TX</span>';
    var txNextHas = ((txPage + 1) * size) < totalTx;
    var txNext = txNextHas ? navLink(buildContractPath(addr, txPage + 1, evPage, eventFilter, size), 'Next TX →') : '<span style="color:var(--muted)">Next TX →</span>';
    var evPrev = evPage > 0 ? navLink(buildContractPath(addr, txPage, evPage - 1, eventFilter, size), '← Prev Event') : '<span style="color:var(--muted)">← Prev Event</span>';
    var evNextHas = ((evPage + 1) * size) < totalEv;
    var evNext = evNextHas ? navLink(buildContractPath(addr, txPage, evPage + 1, eventFilter, size), 'Next Event →') : '<span style="color:var(--muted)">Next Event →</span>';

    document.getElementById('app').innerHTML =
      '<div class="breadcrumb">'+navLink('/','Home')+'<span class="sep">\u203a</span><span>Contract</span></div>'
      +'<div class="card"><div class="card-head">Contract Overview</div>'
      +drow('Address', '<span class="hl" style="word-break:break-all">'+esc(addr)+'</span>'+copyBtn(addr))
      +drow('Owner', addrLink(meta.owner, meta.owner)+copyBtn(meta.owner))
      +drow('Code Hash', '<span class="hl">'+esc(meta.codeHash)+'</span>'+copyBtn(meta.codeHash))
      +drow('Deployed Height', blockLink(meta.deployedAtHeight))
      +drow('Balance', '<strong>'+fmtQtx(balance.balance)+'</strong>')
      +drow('Nonce', String(balance.nonce || 0))
      +drow('Scanned Range', '#'+fromHeight+' → #'+h)
      +drow('Event Filter', eventFilter ? '<span class="badge b-green">'+esc(eventFilter)+'</span>' : '<span style="color:var(--muted)">none</span>')
      +drow('Event Filter Input', '<input id="contract-event-filter" data-addr="'+esc(addr)+'" data-tx-page="'+txPage+'" data-page-size="'+size+'" value="'+esc(eventFilter)+'" placeholder="event name" style="background:var(--bg);border:1px solid var(--border2);border-radius:4px;color:var(--text);padding:4px 8px;font-family:var(--mono);font-size:12px;min-width:200px"> <button class="pnbtn" data-contract-filter="1" data-addr="'+esc(addr)+'" data-tx-page="'+txPage+'" data-ev-page="0" data-page-size="'+size+'">Apply</button> <button class="pnbtn" data-contract-clear="1" data-addr="'+esc(addr)+'" data-tx-page="'+txPage+'" data-page-size="'+size+'">Clear</button>')
      +drow('Quick Filters', filterLinks)
      +drow('Page Size', sizeLinks)
      +drow('TX Pagination', txPrev+' <span style="color:var(--muted)">|</span> '+txNext)
      +drow('Event Pagination', evPrev+' <span style="color:var(--muted)">|</span> '+evNext)
      +'</div>'
      +'<div class="two-col">'
      +'<div class="card"><div class="card-head">Contract Transactions'
      +'<span style="font-weight:400;text-transform:none;font-size:11px;margin-left:6px;color:var(--muted)">page '+(txPage+1)+' / '+txPages+' • '+totalTx+' total</span></div>'
      +'<table class="tbl"><thead><tr><th>Tx Hash</th><th>Type</th><th>From</th><th>Method</th><th>Fee</th><th>Nonce</th></tr></thead><tbody>'+txRows+'</tbody></table></div>'
      +'<div class="card"><div class="card-head">Contract Events'
      +'<span style="font-weight:400;text-transform:none;font-size:11px;margin-left:6px;color:var(--muted)">page '+(evPage+1)+' / '+evPages+' • '+totalEv+' total</span></div>'
      +'<table class="tbl"><thead><tr><th>Tx Hash</th><th>Block</th><th>Name</th><th>Data</th><th>Time</th></tr></thead><tbody>'+evRows+'</tbody></table></div>'
      +'</div>'
      +'<div class="card"><div class="card-head">Storage Snapshot'
      +'<span style="font-weight:400;text-transform:none;font-size:11px;margin-left:6px;color:var(--muted)">'+keys.length+' keys</span></div>'
      +'<table class="tbl"><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>'+keyRows+'</tbody></table></div>';
  } catch(e) {
    document.getElementById('app').innerHTML =
      '<div class="breadcrumb">'+navLink('/','Home')+'<span class="sep">\u203a</span><span>Contract</span></div>'
      +'<div class="err">'+esc(e.message)+'</div>';
  }
}

// ── VALIDATORS PAGE ───────────────────────────────────────────────────────────
async function renderValidators() {
  try {
    var validators = await rpc('qtx_getValidators');
    var rows='';
    if (!validators.length) {
      rows='<tr><td colspan="6" class="empty">No validators registered</td></tr>';
    } else {
      for (var i=0;i<validators.length;i++) {
        var v=validators[i];
        rows+='<tr data-nav="/address/'+esc(v.id)+'">'
          +tblCell('Address', addrLink(v.id,v.id))
          +tblCell('Owner', addrLink(v.owner,v.owner))
          +tblCell('Stake', fmtQtx(v.stake))
          +tblCell('Cumulative Rewards', fmtQtx(v.cumulativeRewards || '0'))
          +tblCell('Status', valBadge(v))
          +tblCell('Missed Blocks', String(v.missedBlocks))
          +'</tr>';
      }
    }
    document.getElementById('app').innerHTML =
      '<div class="breadcrumb">'+navLink('/','Home')+'<span class="sep">\u203a</span><span>Validators</span></div>'
      +'<div class="card"><div class="card-head">All Validators ('+validators.length+')</div>'
      +'<table class="tbl"><thead><tr>'
      +'<th>Address</th><th>Owner</th><th>Stake</th><th>Cumulative Rewards</th><th>Status</th><th>Missed Blocks</th>'
      +'</tr></thead><tbody>'+rows+'</tbody></table></div>';
  } catch(e) {
    document.getElementById('app').innerHTML =
      '<div class="breadcrumb">'+navLink('/','Home')+'<span class="sep">\u203a</span><span>Validators</span></div>'
      +'<div class="err">'+esc(e.message)+'</div>';
  }
}
</script>
</body>
</html>`;
