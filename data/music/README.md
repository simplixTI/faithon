# Music recommendations

`calm-playlist.json` is a hand-curated list of English songs the AI may
recommend when the user asks for music to calm their soul. It's injected
into the system prompt by [`lib/music.js`](../../lib/music.js).

## Why hand-curated

The source Spotify playlist (`1gIgyuj2MUkK8TsLHJtqRo` — "#zapdafe") mixes
PT-BR gospel and English worship. FaithOn speaks English, so only EN tracks
belong here. Language detection from title/artist is unreliable, so we
curate manually.

## When the source playlist changes

```bash
node scripts/sync-spotify-playlist.js
```

The script scrapes the public Spotify embed (no auth needed), writes every
playable track to `_spotify-raw.json`, and prints a diff vs this file —
`+` songs newly added to the playlist, `-` songs removed. Review the `+`
list and manually copy the English ones into `calm-playlist.json` (keep the
same `{id, title, artist, url}` shape).
