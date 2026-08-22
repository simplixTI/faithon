# FaithOn Instagram — Operating Manual

This folder holds the content pipeline for @faithon on Instagram while we operate on **Option 2** (Claude produces, user schedules manually until Meta Business Manager is set up).

## Weekly rhythm

- **Sunday evening / Monday morning:** Claude ships the next week's batch in `weekly/YYYY-Www/`.
- **Monday during the day:** User reviews. Approves in bulk or requests edits inline.
- **Approved content:** Move status to `approved` in the frontmatter, then schedule in Meta Business Suite (or post manually from mobile).
- **After posting:** Move file to `posted/` and log the actual post URL in `frontmatter.post_url`.

## Cadence (locked)

- 3 feed posts / week — **Mon, Wed, Fri**
- 1 reel / week — **Thu**
- 5 stories / week — **Mon–Fri**

## Folder layout

```
content/instagram/
├── README.md                    # this file
├── brand-voice.md               # tone rules, banned words, references
├── pillars.md                   # 5 content pillars — every post maps to one
└── weekly/
    └── 2026-W35/                # one folder per ISO week
        ├── README.md            # weekly plan overview
        ├── feed/
        ├── reel/
        └── stories/
```

## Post file format

Every post file uses this frontmatter + body:

```markdown
---
type: feed | reel | story
pillar: 1-encouragement | 2-heavy-day | 3-human-faith | 4-how-it-works | 5-direct-cta
scheduled: 2026-08-24 09:00 ET
status: pending | approved | posted
post_url: (filled after posting)
---

## Visual brief
[what the image/video should look like — for you or a designer]

## Caption
[the exact caption to paste]

## Hashtags
[hashtag block — pasted at end of caption or as first comment]

## First comment
[optional — thread starter or extra CTA]

## Notes
[anything the user should know before posting]
```

## Non-negotiables (from brand-voice.md)

- CTA is always: **"Text PRAY to 1 (954) 795‑0686"**
- Never use: AI, chatbot, bible bot, algorithm, LLM
- Position: **spiritual companion through text messages**
- Attribution when needed: SIMPLIX LLC

## Git

This folder is safe to commit (no secrets), but if you want drafts private, add `content/instagram/weekly/` to `.gitignore` and only commit the manuals (`README.md`, `brand-voice.md`, `pillars.md`).
