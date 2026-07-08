# Article 7 — The consent stoplight: machine-readable likeness rights, explained

**Purpose:** RSL/HCR/OLP for a general industry reader — canonical link for Series I.
**Notion:** LinkedIn Posts DB · Code `Article 7`

---

# DRAFT — LinkedIn Article

**Title: The consent stoplight: machine-readable likeness rights, explained**

Last month, an AI company's crawler negotiated a likeness licence with one of our talent profiles. No human on our side touched the transaction — by design. To explain why that's good news for performers, I need to start with the problem it answers.

**The scraping default.**

Today, an AI company that wants a person's likeness — for a model, an avatar, a synthetic performance — has two options. Ask, which means finding representation, weeks of email, and terms invented per deal. Or scrape, which means taking what's public and arguing about it later. The asking path is so expensive that scraping wins by default, and the person whose face it is never enters the loop.

June 2026 marked a turn: the Human Consent Registry launched, with high-profile performers publicly declaring their consent terms for AI use. Declaration matters — it converts "everything public is fair game" into "the terms were posted; you drove past them." But a declaration is a sign, not a gate. Someone still has to operate the gate.

**Red. Amber. Green.**

Our contribution is a consent posture: a public, machine-readable statement of a performer's terms, in three colours.

- **Red** — no AI use. The default for everyone, before anyone asks.
- **Amber** — ask. Requests are welcome and route to a human.
- **Green** — yes, on published terms: these use categories, at this rate card, metered.

Two design decisions carry the weight. The posture is **derived, never hand-edited** — it's computed from the standing instructions the performer already set ("always via my agent", "case by case", "never"), so the public signal can't drift from the private intent. And **red is the default** — silence declines. Consent is only ever manufactured by the rights-holder switching it on.

Publishing a posture is itself a consent decision, so it takes two keys: the talent opts in, and an admin approves, before anything is publicly discoverable.

**robots.txt for a human being.**

The posture ships in RSL — a licensing standard the AI-crawler ecosystem already reads — as a license.xml discoverable under a well-known URL. The analogy writes itself: robots.txt told crawlers what they could index; license.xml tells them what a *person's likeness* costs and under what conditions.

The moment a human being's terms became crawlable is, we think, a bigger deal than it looked. Machine-readability is what makes consent cheap enough to respect at scale. A crawler can't email an agent ten thousand times; it can read ten thousand XML files before lunch.

**From crawler to licence: the full walkthrough.**

Here's the amber path, end to end. A crawler discovers a profile's license.xml, sees an amber posture with terms for, say, AI-avatar use, and submits a structured request through the licensing endpoint: intended use category, scope, duration, offered fee. That request lands as a pending licence in the performer's normal approval queue — the same one their human deals flow through, standing instructions applied, rep visibility included. A human decides. Machine-negotiated, human-decided.

The green path removes the wait, not the record: a conforming request within the published categories is auto-granted *at the performer's own rate card*, issued a metered royalty key, and every generation reports against it with splits computed server-side. Green means paid, not free. And consent stays live, not archival — withdrawal revokes keys in real time. Yesterday's yes doesn't authorise tomorrow's use.

Either way, the output is a real licence: scoped, priced, revocable, on the ledger. The same object a human-negotiated deal produces — just cheaper to reach.

**Declaration needs enforcement.**

None of this competes with the Registry; it completes it. Declared terms need production-side machinery: something that verifies the consent is current, meters the use, collects the fee, splits it, and turns withdrawal into revocation. A stoplight nobody enforces is street furniture.

It's worth saying plainly what the AI companies get, because a rail only they won't use protects nobody: verified consent instead of scraping-lawsuit exposure, one integration instead of ten thousand negotiations, metered billing instead of guessed buyouts, and clean revocation handling when a rights-holder changes their mind. Responsible procurement of likeness is currently *hard*; the entire bet is that making it easy makes it normal.

**Where this goes.**

Nothing in the architecture is actor-specific. Athletes, musicians, authors — anyone whose likeness or voice or style is being consumed by machines has the same three needs: a posture, a price, and an enforcement point. What robots.txt did for web content was crude, voluntary — and it still reshaped crawler behaviour, because it made compliance cheaper than defiance.

That's the design goal here too. Red by default. Amber if you're open to offers. Green at your price, on your meter.

Your likeness. Your terms — now in a format a machine can't claim it didn't understand.

*Image Vault built its consent-stoplight rail in the open. One honest caveat, as always: our misuse-monitoring crawler is still simulated while the adjudication pipeline matures — the licensing rail described here is live. If you're a rights-holder or, yes, an AI company: the DMs are open.*

---

**Posting notes:** publish under Luke's byline. Image: deck-slide-2.png. Companion short posts: I1/I2/I3 link here. Registry framing must stay complement-not-competitor (I6); no implication the Registry or any named performer endorses us. Keep the simulated-crawler caveat if excerpting the monitoring line.
