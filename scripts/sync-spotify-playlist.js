// FaithOn — Sync Spotify playlist tracks (no auth, scrapes the embed page)
//
// Usage:
//   node scripts/sync-spotify-playlist.js [playlistUrlOrId]
//
// Default playlist: the one that seeded data/music/calm-playlist.json.
// Writes ALL playable tracks to data/music/_spotify-raw.json for review,
// then diffs against the curated data/music/calm-playlist.json and prints
// what's new / what disappeared. YOU manually copy new EN tracks into the
// curated file — language filtering is intentional, not automated.

const fs = require('fs');
const path = require('path');
const https = require('https');

const DEFAULT_PLAYLIST = '1gIgyuj2MUkK8TsLHJtqRo';
const DATA_DIR = path.join(__dirname, '..', 'data', 'music');
const CURATED = path.join(DATA_DIR, 'calm-playlist.json');
const RAW = path.join(DATA_DIR, '_spotify-raw.json');

function playlistId(input) {
  if (!input) return DEFAULT_PLAYLIST;
  const m = String(input).match(/playlist\/([A-Za-z0-9]+)/);
  return m ? m[1] : input;
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (sync-spotify)' } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function extractTracks(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('__NEXT_DATA__ not found in embed HTML');
  const data = JSON.parse(m[1]);
  let trackList = null;
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o.trackList)) trackList = o.trackList;
    for (const k of Object.keys(o)) walk(o[k]);
  })(data);
  if (!trackList) throw new Error('trackList not found in Spotify response');
  return trackList
    .filter((t) => t.isPlayable)
    .map((t) => {
      const id = t.uri.replace('spotify:track:', '');
      return { id, title: t.title, artist: t.subtitle, url: `https://open.spotify.com/track/${id}` };
    });
}

async function main() {
  const id = playlistId(process.argv[2]);
  console.log(`Fetching playlist ${id}...`);
  const html = await fetchText(`https://open.spotify.com/embed/playlist/${id}`);
  const all = extractTracks(html);
  fs.writeFileSync(RAW, JSON.stringify(all, null, 2));
  console.log(`Wrote ${all.length} playable tracks to ${path.relative(process.cwd(), RAW)}`);

  let curated = [];
  try {
    curated = JSON.parse(fs.readFileSync(CURATED, 'utf8'));
  } catch {}
  const curatedIds = new Set(curated.map((t) => t.id));
  const rawIds = new Set(all.map((t) => t.id));

  const added = all.filter((t) => !curatedIds.has(t.id));
  const removed = curated.filter((t) => !rawIds.has(t.id));

  console.log(`\nDiff vs ${path.basename(CURATED)}:`);
  console.log(`  + ${added.length} new in playlist (review and curate)`);
  for (const t of added) console.log(`      "${t.title}" by ${t.artist}`);
  console.log(`  - ${removed.length} removed from playlist`);
  for (const t of removed) console.log(`      "${t.title}" by ${t.artist}`);
  if (!added.length && !removed.length) console.log('  (curated file is in sync)');
}

main().catch((e) => {
  console.error('sync failed:', e.message);
  process.exit(1);
});
