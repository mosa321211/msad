// One place for the built-in language/audio block list. Per-install overrides
// can be supplied by the /configure page.
const BLOCKED_WORDS = [
  'dubbed', 'dub', 'dual', 'dual audio', 'multi', 'multi-audio',
  'hindi', 'tamil', 'telugu', 'russian', 'rus', 'french', 'vff', 'vf2',
  'german', 'ger', 'spanish', 'latino', 'castellano', 'italian', 'ita',
  'turkish', 'korean dub', 'ukr', 'pol', 'hin', 'dublado', 'dublaj'
];

module.exports = {
  PORT: Number(process.env.PORT) || 7000,
  TORRENTIO_URL: process.env.TORRENTIO_URL || 'https://torrentio.strem.fun/lite',
  MIN_SEEDERS: Number.isFinite(Number(process.env.MIN_SEEDERS)) ? Number(process.env.MIN_SEEDERS) : 15,
  UPSTREAM_TIMEOUT_MS: Number(process.env.UPSTREAM_TIMEOUT_MS) || 8000,
  SUBTITLES_URL: process.env.SUBTITLES_URL || 'https://opensubtitles-v3.strem.io',
  CACHE_TTL_MS: Number(process.env.CACHE_TTL_MS) || 600000,
  BLOCKED_WORDS
};
