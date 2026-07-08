# Article 5 — We deleted 'zero-knowledge' from our spec — and our security got more honest

**Purpose:** The design-decisions essay (B1/B2/B3 combined) — engineering-audience trust builder.
**Notion:** LinkedIn Posts DB · Code `Article 5` · suggested Week 4

---

# DRAFT — LinkedIn Article

**Title: We deleted "zero-knowledge" from our spec — and our security got more honest**

In June, PR #249 removed the words "zero-knowledge" from everything we'd written. No feature shipped. It's still one of the most important changes we've made.

This is the story of that deletion, and of two related decisions — because together they add up to a security philosophy we think more products handling irreplaceable data should adopt: design for the humans you actually have, and publish your limits.

**The dream, and why we specced it.**

Zero-knowledge is the strongest claim a security product can make: encryption keys that never touch our servers, files that even we couldn't read. Investors love it. Landing pages love it more. We specced it in the first architecture document without much debate, because who argues against the maximum security claim?

**The failure mode nobody puts on the landing page.**

Zero-knowledge has a precise cost: if the client loses their passphrase, the data is gone. Forever. No recovery, no support ticket, no exceptions — that is the entire point of the design.

Now look at our actual users. Actors and their agents, storing scan packages of 200 GB to a full terabyte. Face, body, movement — captured at a specific age, for a specific production. Irreplaceable in the truest sense: you cannot re-scan the person you were five years ago.

"One forgotten passphrase away from permanent loss" isn't a security model for these users. It's a liability with good marketing. The threat model that matters isn't a subpoena to our storage provider; it's a busy person, a lost phone, a password manager they never set up. Threat models are for humans, and ours are performers, not cryptographers.

So we chose the honest architecture. Image Vault is server-mediated: AES-256 at rest, TLS 1.3 in transit, and the real protection is structural — no file leaves the vault unless two people, on two sides of the deal, each pass 2FA. That includes us. Every access lands in a tamper-evident, hash-chained ledger. A vault lock freezes everything instantly. We gave up the right to say "not even we can read your files," and kept something we think matters more: no one — including the platform — can release them alone, and nothing happens off the record.

**The second deletion: a backdoor with a timer.**

Honesty, once you start, is habit-forming. We'd built talent "pre-authorisation" so VFX teams could pull files mid-shoot without waking an actor at 3am for a 2FA code. Sensible, operationally. Then we described it accurately: a standing bypass of our signature mechanism. A backdoor with a timer.

We replaced it with Access Windows: opened by the talent in a deliberate 2FA ceremony, capped at 90 days, every download notified in real time, closable instantly. Same operational convenience, completely different security posture — a hotel safe that issues a receipt for everything taken out, rather than a door propped open with a note saying "trust us."

The pattern generalises: **ceremony and audit beat cryptographic theatre.** A control a human can perform correctly, every time, with evidence — beats a stronger control that fails catastrophically the day a human is human.

**The third honesty: perfect DRM is a lie.**

Our Render Bridge enforces licences on the licensee's own infrastructure — revoked files purge from render shares within a heartbeat. It would be easy to market that as "your files can never be misused."

It would also be false, and our spec says so in a section titled honest non-goals. A determined insider with legitimate access can copy a file before expiry. No vendor can prevent that; the ones who claim to are selling the same theatre we deleted. What you *can* do is make every access logged and attributable, every anomaly tamper-reported, and every deletion contractually attested — so misuse is detectable, provable, and expensive. Custody plus evidence beats the copy-proof fantasy, because one of them survives contact with reality.

**Why candour is a security feature.**

There's a reason we publish these limits instead of quietly holding them:

A stated limit is a testable claim. Security products fail worst where marketing exceeds mechanics — that's where customers build process on protection that isn't there. If we say "insiders can copy before expiry, and here is exactly what we log when they do," a vendor designs their pipeline around the truth.

And in our specific seat — a neutral custodian between talent, agencies, and productions — credibility is the product. Overclaiming kills the deal; candour wins it. A custodian you can't audit, whose claims you must take on faith, is just another counterparty.

If a security feature only works when humans are perfect, it isn't a security feature. And if a security claim only works when customers don't read the failure modes, it isn't a security claim. Delete it. You'll be surprised what that buys you.

*Image Vault is consent, custody, and royalty infrastructure for performer likeness data — built in the open, limits included. The DMs are open.*

---

**Posting notes:** publish under Luke's byline (engineering credibility). Text-led; if an image is wanted use product-security.png. Companion short post: B1 ("We deleted our best buzzword") is the pinned teaser and should link here in first comment once live. B2/B3 also link back. Never let excerpts reintroduce "zero-knowledge" as a current claim.
