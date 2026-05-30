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
.topbar{position:sticky;top:0;z-index:100;background:rgba(22,27,34,.95);backdrop-filter:blur(10px);border-bottom:1px solid var(--border);height:56px;padding:0 20px;display:flex;align-items:center;gap:16px}
.logo{display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;color:var(--accent);white-space:nowrap;cursor:pointer;text-decoration:none;flex-shrink:0}
.logo:hover{text-decoration:none;opacity:.85}
.search-box{flex:1;max-width:540px;display:flex;align-items:center;background:var(--bg);border:1px solid var(--border2);border-radius:20px;padding:0 14px;gap:8px;transition:border-color .15s}
.search-box:focus-within{border-color:var(--accent)}
.search-box input{flex:1;background:transparent;border:none;outline:none;color:var(--text);font-family:var(--mono);font-size:12px;padding:8px 0}
.search-box input::placeholder{color:var(--muted2)}
.search-box button{background:none;border:none;color:var(--muted);cursor:pointer;padding:0;display:flex;align-items:center}
.search-box button:hover{color:var(--accent)}
.live{width:8px;height:8px;border-radius:50%;background:var(--muted2);transition:background .3s;flex-shrink:0}
.live.on{background:var(--green)}
#app{max-width:1200px;margin:0 auto;padding:20px 16px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:18px}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:14px 16px}
.stat .lbl{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px}
.stat .val{font-family:var(--mono);font-size:22px;font-weight:700;color:var(--text);line-height:1.2}
.stat .sub{font-size:11px;color:var(--muted);margin-top:3px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;margin-bottom:14px}
.card-head{padding:9px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.6px}
.card-head .va{font-size:11px;text-transform:none;font-weight:400;color:var(--accent);cursor:pointer}
.card-head .va:hover{text-decoration:underline}
.tbl{width:100%;border-collapse:collapse}
.tbl th{padding:6px 14px;text-align:left;font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border);white-space:nowrap;background:var(--surface)}
.tbl td{padding:7px 14px;border-bottom:1px solid var(--border);font-family:var(--mono);font-size:12px;vertical-align:middle}
.tbl tr:last-child td{border-bottom:none}
.tbl tbody tr[data-nav]:hover td{background:var(--surface2);cursor:pointer}
.tbl tbody tr:not([data-nav]):hover td{background:var(--surface2)}
.empty{padding:24px 14px;text-align:center;color:var(--muted);font-family:sans-serif;font-size:13px}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
@media(max-width:768px){.two-col{grid-template-columns:1fr}}
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
  var cls = { transfer:'b-blue', stake:'b-orange', unstake:'b-yellow', validator_register:'b-purple' };
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
function addrLink(addr, display) {
  if (!addr) return '\u2014';
  return navLink('/address/'+addr, esc(display||truncAddr(addr)));
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
  var nv = e.target.closest('[data-nav]');
  if (nv) { e.preventDefault(); navigate(nv.dataset.nav); }
});
function doSearch() {
  var q = document.getElementById('gsearch').value.trim();
  if (!q) return;
  if (/^[0-9]+$/.test(q))  { navigate('/block/'+q); return; }
  if (/^qtx/i.test(q))  { navigate('/address/'+q); return; }
  navigate('/tx/'+q);
}
document.getElementById('gsearch').addEventListener('keydown', function(e) { if (e.key==='Enter') doSearch(); });
document.getElementById('search-btn').addEventListener('click', doSearch);
var _timer = null;
function stopTimer() { if (_timer) { clearInterval(_timer); _timer = null; } }
function navigate(path) { location.hash = '#'+path; }
function route() {
  stopTimer();
  var path = location.hash.replace(/^#/,'') || '/';
  document.getElementById('app').innerHTML = '<div class="loading">Loading\u2026</div>';
  if (path==='/'||path==='')           renderHome();
  else if (path.startsWith('/block/')) renderBlock(Number(path.slice(7)));
  else if (path.startsWith('/tx/'))    renderTx(path.slice(4));
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
      ]);
      var info=res[0], latest=res[1], validators=res[2], mempool=res[3], peers=res[4];
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
      document.getElementById('app').innerHTML = buildHome(info,h,blocks,recentTxs,validators,activeV,mempool,peers);
    } catch(e) {
      document.getElementById('app').innerHTML = '<div class="err">Failed to connect: '+esc(e.message)+'</div>';
    } finally { dotOff(); }
  }
  await load();
  _timer = setInterval(load, 4000);
}

function buildHome(info, h, blocks, recentTxs, validators, activeV, mempool, peers) {
  var stats = '<div class="stats">'
    +'<div class="stat"><div class="lbl">Block Height</div><div class="val">'+h.toLocaleString()+'</div><div class="sub">latest committed</div></div>'
    +'<div class="stat"><div class="lbl">Active Validators</div><div class="val">'+activeV+'</div><div class="sub">of '+validators.length+' registered</div></div>'
    +'<div class="stat"><div class="lbl">Mempool</div><div class="val">'+mempool.length+'</div><div class="sub">pending txs</div></div>'
    +'<div class="stat"><div class="lbl">Block Interval</div><div class="val">'+(info?info.blockIntervalMs:4000)+'ms</div><div class="sub">'+esc(info?info.chainId:'')+'</div></div>'
    +'<div class="stat"><div class="lbl">Peers</div><div class="val">'+peers.length+'</div><div class="sub">connected nodes</div></div>'
    +'</div>';
  var blkRows='';
  if (!blocks.length) { blkRows='<tr><td colspan="5" class="empty">No blocks yet</td></tr>'; }
  else for (var i=0;i<blocks.length;i++) {
    var b=blocks[i];
    blkRows+='<tr data-nav="/block/'+b.height+'">'
      +'<td>'+blockLink(b.height)+'</td>'
      +'<td style="color:var(--muted);font-family:sans-serif">'+esc(fmtTime(b.timestamp))+'</td>'
      +'<td>'+addrLink(b.proposer)+'</td>'
      +'<td>'+b.txCount+'</td>'
      +'<td>'+statusBadge(b.committed)+'</td>'
      +'<td style="color:var(--muted);font-size:11px">'+esc(truncHash(b.hash))+'</td>'
      +'</tr>';
  }
  var txRows='';
  if (!recentTxs.length) { txRows='<tr><td colspan="5" class="empty">No transactions yet</td></tr>'; }
  else for (var j=0;j<recentTxs.length;j++) {
    var t=recentTxs[j].tx;
    txRows+='<tr data-nav="/tx/'+esc(t.hash)+'">'
      +'<td>'+txLink(t.hash)+'</td>'
      +'<td style="color:var(--muted);font-family:sans-serif">'+esc(fmtTime(t.timestamp))+'</td>'
      +'<td>'+typeBadge(t.type)+'</td>'
      +'<td>'+addrLink(t.from)+'</td>'
      +'<td>'+(t.to?addrLink(t.to):t.validatorId?addrLink(t.validatorId):'\u2014')+'</td>'
      +'<td>'+fmtQtx(t.amount)+'</td>'
      +'</tr>';
  }
  var valRows='';
  if (!validators.length) { valRows='<tr><td colspan="4" class="empty">No validators registered</td></tr>'; }
  else for (var k=0;k<validators.length;k++) {
    var v=validators[k];
    valRows+='<tr data-nav="/address/'+esc(v.id)+'">'
      +'<td>'+addrLink(v.id,truncAddr(v.id))+'</td>'
      +'<td>'+fmtQtx(v.stake)+'</td>'
      +'<td>'+valBadge(v)+'</td>'
      +'<td>'+v.missedBlocks+'</td>'
      +'</tr>';
  }
  var mpRows='';
  if (!mempool.length) { mpRows='<tr><td colspan="5" class="empty">Empty \u2014 no pending transactions</td></tr>'; }
  else {
    var mp8=mempool.slice(0,8);
    for (var m=0;m<mp8.length;m++) {
      var mt=mp8[m];
      mpRows+='<tr>'
        +'<td>'+txLink(mt.hash)+'</td>'
        +'<td>'+typeBadge(mt.type)+'</td>'
        +'<td>'+addrLink(mt.from)+'</td>'
        +'<td>'+fmtQtx(mt.amount)+'</td>'
        +'<td>'+mt.nonce+'</td>'
        +'</tr>';
    }
    if (mempool.length>8) mpRows+='<tr><td colspan="5" class="empty">+ '+(mempool.length-8)+' more\u2026</td></tr>';
  }
  var peerRows='';
  if (!peers.length) { peerRows='<tr><td colspan="2" class="empty">No peers connected</td></tr>'; }
  else for (var p=0;p<peers.length;p++) {
    peerRows+='<tr><td>'+esc(peers[p].id)+'</td><td style="color:var(--muted)">'+esc(peers[p].endpoint)+'</td></tr>';
  }
  return stats
    +'<div class="two-col">'
    +'<div class="card"><div class="card-head">Recent Blocks</div>'
    +'<table class="tbl"><thead><tr><th>Height</th><th>Time</th><th>Proposer</th><th>Txs</th><th>Status</th><th>Hash</th></tr></thead>'
    +'<tbody>'+blkRows+'</tbody></table></div>'
    +'<div class="card"><div class="card-head">Recent Transactions</div>'
    +'<table class="tbl"><thead><tr><th>Tx Hash</th><th>Time</th><th>Type</th><th>From</th><th>To</th><th>Amount</th></tr></thead>'
    +'<tbody>'+txRows+'</tbody></table></div>'
    +'</div>'
    +'<div class="card"><div class="card-head">Validators'
    +'<a class="va" data-nav="/validators">View all \u2197</a></div>'
    +'<table class="tbl"><thead><tr><th>Address</th><th>Stake</th><th>Status</th><th>Missed Blocks</th></tr></thead>'
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
    var maxH   = latest.height;
    var txRows='';
    if (!block.txs||!block.txs.length) {
      txRows='<tr><td colspan="8" class="empty">No transactions in this block</td></tr>';
    } else {
      for (var i=0;i<block.txs.length;i++) {
        var t=block.txs[i];
        txRows+='<tr data-nav="/tx/'+esc(t.hash)+'">'
          +'<td>'+txLink(t.hash)+'</td>'
          +'<td style="color:var(--muted);font-family:sans-serif">'+esc(fmtTime(t.timestamp))+'</td>'
          +'<td>'+typeBadge(t.type)+'</td>'
          +'<td>'+addrLink(t.from)+'</td>'
          +'<td>'+(t.to?addrLink(t.to):t.validatorId?addrLink(t.validatorId):'\u2014')+'</td>'
          +'<td>'+fmtQtx(t.amount)+'</td>'
          +'<td>'+fmtQtx(t.fee)+'</td>'
          +'<td>'+t.nonce+'</td>'
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
async function renderTx(hash) {
  try {
    var t = await rpc('qtx_getTransaction',[hash]);
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
      +drow('Timestamp', esc(fmtTime(t.timestamp)))
      +drow('Amount', fmtQtx(t.amount))
      +drow('Fee', fmtQtx(t.fee))
      +drow('Nonce', String(t.nonce))
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
    var fetches=[];
    for (var i=Math.max(0,h-49);i<=h;i++) fetches.push(rpc('qtx_getBlock',[i]).catch(function(){return null;}));
    var blocks=(await Promise.all(fetches)).filter(Boolean);
    var history=[];
    for (var bi=0;bi<blocks.length;bi++) {
      var txs=blocks[bi].txs||[];
      for (var ti=0;ti<txs.length;ti++) {
        var tx=txs[ti];
        if (tx.from===addr||tx.to===addr||tx.validatorId===addr) history.push({tx:tx,bh:blocks[bi].height});
      }
    }
    history.reverse();
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
        var cp=isOut?(t.to?addrLink(t.to):t.validatorId?addrLink(t.validatorId):'\u2014'):addrLink(t.from);
        txRows+='<tr data-nav="/tx/'+esc(t.hash)+'">'
          +'<td>'+txLink(t.hash)+'</td>'
          +'<td>'+blockLink(item.bh)+'</td>'
          +'<td style="color:var(--muted);font-family:sans-serif">'+esc(fmtTime(t.timestamp))+'</td>'
          +'<td>'+typeBadge(t.type)+'</td>'
          +'<td>'+dir+'</td>'
          +'<td>'+cp+'</td>'
          +'<td>'+fmtQtx(t.amount)+'</td>'
          +'</tr>';
      }
    }
    document.getElementById('app').innerHTML =
      '<div class="breadcrumb">'+navLink('/','Home')+'<span class="sep">\u203a</span><span>Address</span></div>'
      +'<div class="card"><div class="card-head">Address</div>'
      +drow('Address', '<span class="hl" style="word-break:break-all">'+esc(addr)+'</span>'+copyBtn(addr))
      +drow('Balance', '<strong>'+fmtQtx(acc.balance)+'</strong>')
      +drow('Staked', fmtQtx(acc.staked))
      +drow('Nonce', String(acc.nonce))
      +(validator?drow('Validator',valBadge(validator)+'&nbsp;&nbsp;missed: '+validator.missedBlocks):'')
      +'</div>'
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

// ── VALIDATORS PAGE ───────────────────────────────────────────────────────────
async function renderValidators() {
  try {
    var validators = await rpc('qtx_getValidators');
    var rows='';
    if (!validators.length) {
      rows='<tr><td colspan="5" class="empty">No validators registered</td></tr>';
    } else {
      for (var i=0;i<validators.length;i++) {
        var v=validators[i];
        rows+='<tr data-nav="/address/'+esc(v.id)+'">'
          +'<td>'+addrLink(v.id,v.id)+'</td>'
          +'<td>'+addrLink(v.owner,v.owner)+'</td>'
          +'<td>'+fmtQtx(v.stake)+'</td>'
          +'<td>'+valBadge(v)+'</td>'
          +'<td>'+v.missedBlocks+'</td>'
          +'</tr>';
      }
    }
    document.getElementById('app').innerHTML =
      '<div class="breadcrumb">'+navLink('/','Home')+'<span class="sep">\u203a</span><span>Validators</span></div>'
      +'<div class="card"><div class="card-head">All Validators ('+validators.length+')</div>'
      +'<table class="tbl"><thead><tr>'
      +'<th>Address</th><th>Owner</th><th>Stake</th><th>Status</th><th>Missed Blocks</th>'
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
