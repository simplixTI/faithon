// FaithOn — Calming music recommendations
//
// Loads the hand-curated English playlist and formats it as a block that
// gets appended to the system prompt. The AI decides when to recommend —
// typically when the user asks for a song or when a song clearly fits.

const fs = require('fs');
const path = require('path');

const PLAYLIST_PATH = path.join(__dirname, '..', 'data', 'music', 'calm-playlist.json');

let cached = null;
function getCalmPlaylist() {
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(PLAYLIST_PATH, 'utf8');
    cached = JSON.parse(raw);
    if (!Array.isArray(cached)) cached = [];
  } catch {
    cached = [];
  }
  return cached;
}

function formatMusicBlock() {
  const tracks = getCalmPlaylist();
  if (!tracks.length) return null;
  const lines = tracks.map((t) => `- "${t.title}" by ${t.artist} → ${t.url}`);
  return [
    'Music you can recommend:',
    'When the person asks for a song to calm their soul (or when a song would clearly help them settle), you may recommend ONE track from the list below. Say the title and artist naturally in a sentence, then put the Spotify link on a new line. Only recommend when they ask or when it clearly fits — never push music. Pick one that matches their emotional state. All songs below are in English.',
    '',
    lines.join('\n'),
  ].join('\n');
}

module.exports = { getCalmPlaylist, formatMusicBlock };
