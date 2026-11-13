const test = require('node:test');
const assert = require('node:assert/strict');
const { filterAndRank, filterArabicSubtitles, parseSeeders, parseResolution, parseSize } = require('../filter');
const defaults = require('../config');

test('parses seeders, resolution, and file size', () => {
  assert.equal(parseSeeders('[👤 1,234]'), 1234);
  assert.equal(parseSeeders('👤 25 |'), 25);
  assert.equal(parseResolution('Show.2160p.WEB-DL'), '2160p');
  assert.equal(parseSize('file 2.1GB'), '2.1GB');
});

test('filters dubbed/language and bad release markers, ranks quality then seeders, preserves playback fields', () => {
  const inputs = [
    { name: 'Movie 720p [👤 900]', infoHash: 'low', fileIdx: 1 },
    { name: 'Movie 1080p English [👤 50] 2GB', infoHash: 'eng', fileIdx: 2, behaviorHints: { bingeGroup: 'x' } },
    { name: 'Movie 2160p [👤 4] 4GB', infoHash: '4k', fileIdx: 3 },
    { name: 'Movie 2160p Hindi [👤 999]', infoHash: 'hindi' },
    { name: 'Movie 2160p CAM [👤 999]', infoHash: 'cam' }
  ];
  const { streams, stats } = filterAndRank(inputs, { minSeeders: 15, blockedWords: defaults.BLOCKED_WORDS });
  assert.deepEqual(streams.map(s => s.infoHash), ['eng', 'low']);
  assert.equal(streams[0].fileIdx, 2);
  assert.deepEqual(streams[0].behaviorHints, { bingeGroup: 'x' });
  assert.match(streams[0].name, /1080p \| 👤 50 \| 2GB/);
  assert.equal(stats.blockedLanguage, 1);
  assert.equal(stats.camOrScreener, 1);
});

test('falls back to up to five remaining clean streams when all are below minimum', () => {
  const input = Array.from({ length: 7 }, (_, i) => ({ name: `Film ${i} 720p [👤 ${i}]`, infoHash: `${i}` }));
  const result = filterAndRank(input, { minSeeders: 15, blockedWords: [] });
  assert.equal(result.stats.fallback, true);
  assert.equal(result.streams.length, 5);
  assert.equal(result.streams[0].infoHash, '6');
});

test('supports debrid cache preference without dropping original URLs', () => {
  const result = filterAndRank([
    { name: 'Movie 2160p [👤 100]', url: 'magnet:?xt=urn:btih:aaa' },
    { name: 'Movie 720p [RD+] [👤 1]', url: 'https://debrid.example/stream/abc' }
  ], { minSeeders: 0, blockedWords: [], debridConfigured: true });
  assert.match(result.streams[0].name, /720p/);
  assert.equal(result.streams[0].url, 'https://debrid.example/stream/abc');
});

test('checks the Torrentio behaviorHints filename for blocked language markers', () => {
  const result = filterAndRank([
    { name: 'Torrentio 1080p [👤 200]', behaviorHints: { filename: 'release.dublado.mkv' } },
    { name: 'Torrentio 1080p [👤 200]', behaviorHints: { filename: 'release.eng.mkv' } }
  ], { minSeeders: 15, blockedWords: defaults.BLOCKED_WORDS });
  assert.equal(result.streams.length, 1);
  assert.equal(result.stats.blockedLanguage, 1);
});

test('returns only Arabic subtitles, deduplicated by id or URL and ranked by available signals', () => {
  const items = [
    { id: 'a', url: 'one', lang: 'ara', downloads: 4 },
    { id: 'b', url: 'one', lang: 'ara', downloads: 99 },
    { id: 'c', url: 'two', language: 'ara', rating: 8 },
    { id: 'd', url: 'three', lang: 'eng', downloads: 999 }
  ];
  assert.deepEqual(filterArabicSubtitles(items).map(x => x.id), ['a', 'c']);
});
