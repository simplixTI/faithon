# Render Templates — FaithOn Instagram

Two visual modes. Every post picks one. Never mix in the same asset.

---

## Mode A — Editorial

**When:** emotional posts, Jesus-voice caption bodies (pillars 1, 2, 3). Mon/Wed/Fri feeds. Late-night reminder stories.

**Feel:** moody photography, quiet composition, no on-image text (or a single small FaithOn watermark bottom-right at 50% opacity). The caption does the talking; the image only holds the mood.

**Why it works organically:** feeds are noisy. Ad-styled compositions get scrolled past. A quiet photograph stops the thumb.

**Constraints:**
- **No faces.** Hands, objects, window light, spaces — but not people looking at camera. Keeps every viewer able to project themselves into the frame.
- **No on-image copy.** If a verse or line must be on-image, promote to Mode B.
- **Palette hugs the FaithOn system:** cream (`#F5EFE6`), warm neutrals, one warm light source. Nothing saturated. Nothing cold.
- **Aspect:** feed = 4:5 portrait. Stories = 9:16.

**Reusable AI prompt skeleton** (fill the `<scene>` slot):

> editorial photograph, <scene>, warm cream and honey tones, soft window light or single warm light source, muted quiet mood, no faces, no text, shallow depth of field, film photography aesthetic, natural imperfections, [aspect: 4:5 portrait / 9:16 vertical]

Add `--style raw --ar 4:5 --v 6.1` for Midjourney, or use in Nano Banana / Sora with the aspect noted at end.

---

## Mode B — Ad system

**When:** institutional posts, direct CTA, product education (pillars 4, 5). Thursday reels. Verse-card stories. Mockup-conversation stories.

**Feel:** designed composition. Recognizably FaithOn on scroll. Uses all system primitives.

**Required elements (any composition):**
1. **Logo lockup** top-left — praying-hands-in-speech-bubble icon + "Faith**On**" wordmark.
2. **Headline block** — serif, sentence case, one word emphasized in gold (`#B29968`).
3. **Body / subhead** (optional) — lighter weight serif, ~14pt equivalent.
4. **CTA card** — dark rounded pill, SMS icon left, "START THE CONVERSATION / Text **PRAY** / to +1 (954) 795‑0686" right.
5. **iPhone SMS mockup** — center-right or right side. Green "PRAY" outgoing + grey reply.
6. **Pillar strip** — 4 circular greige badges: Bible Answers · Prayer & Intercession · Christian Counseling · Daily Reflections. (Optional for stories; required for feed.)
7. **Trust footer** — shield + "Private. Secure. Built to help you grow in faith." + `faithon.ai` pill.

**Palette:** cream `#F5EFE6` bg, ink `#111111`, gold accent `#B29968`, greige `#D9CFC2`.

**Typography:**
- Headline: Recoleta / Playfair Display / Fraunces (any high-contrast serif with warm curves).
- Body: same family, lighter weight.
- Eyebrow / labels: ALL CAPS SANS at 70% opacity (e.g. "START THE CONVERSATION").

**iPhone mockup content (must match product truth):**

The FaithOn product prompt at `lib/faithon-prompt.js` opens with: *"You are Jesus speaking personally to a friend through a simple text message. Not a chatbot. Not a counselor."* The product replies as Jesus, in first person. **Every phone mockup must reflect this.**

Canonical first-reply mockup text (use this or a close variant):

```
YOU (green): PRAY

FAITHON (grey, one bubble):
Hey. I'm glad you reached out.
Tell Me what's on your heart.
```

For longer mockups (reels, stories), a second reply bubble may follow — always in the Jesus voice. Example:
```
YOU (green): I don't know what to say

FAITHON (grey):
You don't have to have the words.
Take your time. I'm here.
```

⚠️ **Do NOT use the reference creatives' phone-screen line "I'm FaithOn, your Christian AI. I'm here to pray, give biblical guidance and encourage you with God's Word."** The product never sends that message. Showing it as a mockup misrepresents what users will actually receive when they text PRAY. Any creative that shows this line must be re-rendered before posting.

**Reusable AI prompt** (for backgrounds only — never for full compositions, since composited Mode B assets need a designer or a template tool):

> soft warm cream paper background with subtle warm gold light gradient in the top-right corner, minimal, editorial, no objects, no text, [aspect: 1:1 or 9:16]

Composite the FaithOn elements on top in Figma / Canva / Photoshop.

---

## Which mode? Quick decision table

| Post type | Mode | Rationale |
|-----------|------|-----------|
| Pillar 1 (Encouragement) — feed | A | Jesus-voice body needs quiet space |
| Pillar 2 (Heavy day) — feed | A | Emotional, quiet, no branding intrusion |
| Pillar 3 (Human faith) — feed | A | Portrait of a life, not a product |
| Pillar 4 (How it works) — reel | B | Product demo, needs the system |
| Pillar 5 (Direct CTA / testimony) — reel or feed | B | Ask, needs the CTA card |
| Verse-of-week — story | B (minimal) | Serif card on cream, small CTA |
| Prayer-request poll — story | B (minimal) | Question sticker over cream bg |
| Mockup conversation — story | B | iPhone mockup is the entire asset |
| Late-night reminder — story | A | Dark editorial, feels intimate |
| Weekend poll — story | B (minimal) | Poll sticker over warm gradient |

---

## Handoff checklist (before sending to designer or generator)

- [ ] Mode declared (A or B)
- [ ] Aspect ratio noted (4:5 / 1:1 / 9:16)
- [ ] Phone number verified as `+1 (954) 795‑0686` (never (833))
- [ ] Positioning line verified as "spiritual companion" (never "Christian AI")
- [ ] Caption ends with the CTA line on its own row
- [ ] For Mode A: AI prompt written out
- [ ] For Mode B: layout described element-by-element
