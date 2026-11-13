'use strict';

const http = require('node:http');
const { URL } = require('node:url');
const config = require('./config');
const { filterAndRank, filterArabicSubtitles } = require('./filter');

const cache = new Map();
const manifest = {
  id: 'community.smart-torrentio-filter',
  version: '1.0.0',
  name: 'Smart Torrentio',
  description: 'Filters Torrentio streams and provides Arabic subtitles.',
  resources: ['stream', 'subtitles'],
  types: ['movie', 'series'],
  idPrefixes: ['tt']
};

function configFromSegment(segment) {
  if (!segment) return {};
  const decoded = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('Invalid config');
  const next = {};
  if (Number.isFinite(Number(decoded.minSeeders))) next.minSeeders = Math.max(0, Math.min(100000, Number(decoded.minSeeders)));
  if (Array.isArray(decoded.blockedWords)) next.blockedWords = decoded.blockedWords.map(String).map(s => s.trim()).filter(Boolean).slice(0, 200);
  if (typeof decoded.upstreamUrl === 'string' && decoded.upstreamUrl.trim()) next.upstreamUrl = validateHttpUrl(decoded.upstreamUrl.trim());
  return next;
}

function validateHttpUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Upstream URL must use http or https');
  return url.toString().replace(/\/$/, '');
}

function getConfig(segment) {
  const supplied = configFromSegment(segment);
  const upstreamUrl = supplied.upstreamUrl || config.TORRENTIO_URL.replace(/\/$/, '');
  const parsed = new URL(upstreamUrl);
  return {
    minSeeders: supplied.minSeeders ?? config.MIN_SEEDERS,
    blockedWords: supplied.blockedWords ?? config.BLOCKED_WORDS,
    upstreamUrl,
    debridConfigured: /(?:^|\/)(?:realdebrid|premiumize|alldebrid|debridlink|easydebrid|offcloud|torbox|putio|highway)=/i.test(parsed.pathname)
  };
}

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expires <= Date.now()) { cache.delete(key); return undefined; }
  return entry.value;
}
function cacheSet(key, value) {
  cache.set(key, { value, expires: Date.now() + config.CACHE_TTL_MS });
  if (cache.size > 500) {
    for (const [oldKey, entry] of cache) if (entry.expires <= Date.now() || cache.size > 450) cache.delete(oldKey);
  }
}

async function fetchJson(url, timeoutMs = config.UPSTREAM_TIMEOUT_MS) {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Upstream returned HTTP ${response.status}`);
  return response.json();
}

async function cachedJson(key, url) {
  const existing = cacheGet(key);
  if (existing !== undefined) return existing;
  const pendingKey = `pending:${key}`;
  const pending = cacheGet(pendingKey);
  if (pending) return pending;
  const task = fetchJson(url).then(value => { cacheSet(key, value); return value; }).finally(() => cache.delete(pendingKey));
  cacheSet(pendingKey, task);
  return task;
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data), 'access-control-allow-origin': '*' });
  res.end(data);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const configureHtml = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Smart Torrentio setup</title>
<style>body{font:16px system-ui;max-width:760px;margin:32px auto;padding:0 16px;color:#17202a}label{display:block;margin:18px 0 6px;font-weight:650}input,textarea{box-sizing:border-box;width:100%;padding:10px;font:inherit}button{margin-top:18px;padding:12px 18px;background:#2267d8;color:white;border:0;border-radius:5px;font:inherit;cursor:pointer}pre{white-space:pre-wrap;word-break:break-all;background:#f3f5f7;padding:12px}.note{color:#46515c}</style>
<h1>Smart Torrentio</h1><p>Choose the filtering settings and generate a Stremio install link.</p>
<label for="min">Minimum seeders</label><input id="min" type="number" min="0" value="${config.MIN_SEEDERS}">
<label for="upstream">Torrentio upstream URL</label><input id="upstream" value="${escapeHtml(config.TORRENTIO_URL)}">
<label for="words">Blocked words (one per line)</label><textarea id="words" rows="8">${escapeHtml(config.BLOCKED_WORDS.join('\n'))}</textarea>
<button id="generate">Generate install link</button><p id="status" class="note"></p><pre id="result"></pre>
<script>document.querySelector('#generate').onclick=()=>{try{const config={minSeeders:Number(document.querySelector('#min').value),upstreamUrl:document.querySelector('#upstream').value.trim(),blockedWords:document.querySelector('#words').value.split(/\\r?\\n/).map(x=>x.trim()).filter(Boolean)};const json=JSON.stringify(config);const bytes=new TextEncoder().encode(json);let bin='';bytes.forEach(b=>bin+=String.fromCharCode(b));const b64=btoa(bin).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');const url=location.origin+'/config/'+b64+'/manifest.json';document.querySelector('#result').textContent=url;document.querySelector('#status').textContent='Install via Stremio using this manifest URL.';}catch(e){document.querySelector('#status').textContent='Invalid settings: '+e.message;}}</script></html>`;

function parseRoute(pathname) {
  let m = pathname.match(/^\/config\/([A-Za-z0-9_-]+)\/(manifest\.json|stream|subtitles)(?:\/([^/]+)\/([^/]+)\.json)?\/?$/);
  if (m) return { segment: m[1], resource: m[2], type: m[3], id: m[4] };
  m = pathname.match(/^\/(manifest\.json|stream|subtitles)(?:\/([^/]+)\/([^/]+)\.json)?\/?$/);
  if (m) return { segment: '', resource: m[1], type: m[2], id: m[3] };
  return null;
}

async function handle(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && (requestUrl.pathname === '/' || requestUrl.pathname === '/configure')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(configureHtml); return;
  }
  const route = parseRoute(requestUrl.pathname);
  if (!route) { sendJson(res, 404, { error: 'Not found' }); return; }
  let userConfig;
  try { userConfig = getConfig(route.segment); }
  catch (error) { sendJson(res, 400, { error: error.message }); return; }

  if (route.resource === 'manifest.json') { sendJson(res, 200, manifest); return; }
  let id;
  try { id = decodeURIComponent(route.id || ''); } catch { sendJson(res, 400, { error: 'Invalid id' }); return; }
  if (!['movie', 'series'].includes(route.type) || !id.startsWith('tt')) { sendJson(res, 400, { [route.resource]: [] }); return; }

  if (route.resource === 'stream') {
    const key = JSON.stringify(['stream', userConfig.upstreamUrl, route.type, id]);
    try {
      const upstream = await cachedJson(key, `${userConfig.upstreamUrl}/stream/${route.type}/${encodeURIComponent(id)}.json`);
      const result = filterAndRank(upstream?.streams, userConfig);
      console.log(`[stream ${route.type}/${id}] in=${result.stats.incoming} blocked-language=${result.stats.blockedLanguage} cam-ts-scr=${result.stats.camOrScreener} below-min=${result.stats.lowSeeders} fallback=${result.stats.fallback} out=${result.stats.returned}`);
      sendJson(res, 200, { streams: result.streams });
    } catch (error) {
      console.warn(`[stream ${route.type}/${id}] upstream failed: ${error.message}`);
      sendJson(res, 200, { streams: [] });
    }
    return;
  }

  if (route.resource === 'subtitles') {
    const key = JSON.stringify(['subtitles', config.SUBTITLES_URL, route.type, id]);
    try {
      const upstream = await cachedJson(key, `${config.SUBTITLES_URL.replace(/\/$/, '')}/subtitles/${route.type}/${encodeURIComponent(id)}.json`);
      const subtitles = filterArabicSubtitles(upstream?.subtitles);
      console.log(`[subtitles ${route.type}/${id}] in=${upstream?.subtitles?.length || 0} arabic=${subtitles.length}`);
      sendJson(res, 200, { subtitles });
    } catch (error) {
      console.warn(`[subtitles ${route.type}/${id}] upstream failed: ${error.message}`);
      sendJson(res, 200, { subtitles: [] });
    }
    return;
  }
  sendJson(res, 404, { error: 'Unknown resource' });
}

const server = http.createServer((req, res) => { handle(req, res).catch(error => { console.error('Request failed:', error); if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error' }); else res.end(); }); });

if (require.main === module) {
  server.listen(config.PORT, '0.0.0.0', () => console.log(`Smart Torrentio listening on http://0.0.0.0:${config.PORT}`));
}

module.exports = { server, handle, manifest, configFromSegment, getConfig, cache };
