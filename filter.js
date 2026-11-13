const RESOLUTION_SCORE = { '2160p': 4, '1080p': 3, '720p': 2 };
const AVOID_RELEASE = /(?:^|[\s._\[\](){}-])(?:cam(?:rip)?|ts|hdts|scr(?:eener)?)(?=$|[\s._\[\](){}-])/i;
const ENGLISH_ORIGINAL = /(?:\benglish\b|\beng\b|\boriginal\b)/i;
const SEEDER = /(?:👤\s*|\bseeders?\s*[:|\-]?\s*)(\d[\d,._]*)/i;
const SIZE = /\b(\d+(?:[.,]\d+)?)\s*(B|KB|MB|GB|TB)\b/i;

function textOf(stream) {
  return [stream.name, stream.title, stream.filename, stream.fileName, stream.description, stream.behaviorHints?.filename]
    .filter(value => typeof value === 'string').join(' ');
}

function parseSeeders(text) {
  const match = String(text || '').match(SEEDER);
  return match ? Number(match[1].replace(/[,_\.]/g, '')) || 0 : 0;
}

function parseResolution(text) {
  const match = String(text || '').match(/(?:^|[^\d])(2160|1080|720)p(?:$|[^a-z\d])/i);
  return match ? `${match[1]}p` : 'other';
}

function parseSize(text) {
  const match = String(text || '').match(SIZE);
  return match ? `${match[1].replace(',', '.')}${match[2].toUpperCase()}` : '';
}

function markerRegex(word) {
  const normalized = String(word).trim().replace(/\s+/g, '[\\s._-]+');
  if (!normalized) return null;
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'iu');
}

function cleanLabel(stream, meta) {
  const parts = [];
  if (meta.resolution !== 'other') parts.push(meta.resolution);
  parts.push(`👤 ${meta.seeders}`);
  if (meta.size) parts.push(meta.size);
  return `⚡ ${parts.join(' | ')}`;
}

function filterArabicSubtitles(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items
    .filter(item => item && String(item.lang || item.language || '').toLowerCase() === 'ara')
    .filter(item => {
      const keys = [item.url && `url:${item.url}`, item.id && `id:${item.id}`].filter(Boolean);
      if (keys.some(key => seen.has(key))) return false;
      keys.forEach(key => seen.add(key));
      return true;
    })
    .sort((a, b) => (Number(b.downloads) || 0) - (Number(a.downloads) || 0) || (Number(b.rating) || 0) - (Number(a.rating) || 0));
}

function filterAndRank(streams, options = {}) {
  const minSeeders = Math.max(0, Number(options.minSeeders ?? 15) || 0);
  const blockedWords = Array.isArray(options.blockedWords) ? options.blockedWords : [];
  const blocked = blockedWords.map(markerRegex).filter(Boolean);
  const debridConfigured = Boolean(options.debridConfigured);
  const stats = { incoming: Array.isArray(streams) ? streams.length : 0, blockedLanguage: 0, camOrScreener: 0, lowSeeders: 0, returned: 0, fallback: false };
  if (!Array.isArray(streams)) return { streams: [], stats };

  const accepted = [];
  for (const stream of streams) {
    if (!stream || typeof stream !== 'object') continue;
    const text = textOf(stream);
    if (blocked.some(regex => regex.test(text))) { stats.blockedLanguage++; continue; }
    if (AVOID_RELEASE.test(text)) { stats.camOrScreener++; continue; }
    const seeders = parseSeeders(text);
    const resolution = parseResolution(text);
    const size = parseSize(text);
    const hasLanguageTag = /(?:^|[\s._\[\](){}-])(?:eng|english|rus|russian|ita|french|german|spanish|latino|hindi|dual|multi)(?=$|[\s._\[\](){}-])/i.test(text);
    const originalBonus = ENGLISH_ORIGINAL.test(text) || !hasLanguageTag ? 1 : 0;
    const cached = /\[(?:RD|PM|AD|DL|ED|OC|TB|PUT)\+?\]/i.test(text) || (debridConfigured && typeof stream.url === 'string' && !/^(?:magnet:|https?:\/\/[^/]*(?:torrent|\.torrent))/i.test(stream.url));
    accepted.push({ stream, text, seeders, resolution, size, originalBonus, cached });
  }

  let selected = accepted.filter(item => item.seeders >= minSeeders);
  stats.lowSeeders = accepted.length - selected.length;
  if (selected.length === 0 && accepted.length > 0) {
    stats.fallback = true;
    selected = accepted.slice().sort((a, b) => b.seeders - a.seeders).slice(0, 5);
  }

  selected.sort((a, b) => {
    if (debridConfigured && a.cached !== b.cached) return Number(b.cached) - Number(a.cached);
    return (RESOLUTION_SCORE[b.resolution] || 1) - (RESOLUTION_SCORE[a.resolution] || 1)
      || b.seeders - a.seeders
      || b.originalBonus - a.originalBonus;
  });

  const out = selected.map(item => ({
    ...item.stream,
    name: cleanLabel(item.stream, item)
  }));
  stats.returned = out.length;
  return { streams: out, stats };
}

module.exports = { filterAndRank, filterArabicSubtitles, parseSeeders, parseResolution, parseSize };
