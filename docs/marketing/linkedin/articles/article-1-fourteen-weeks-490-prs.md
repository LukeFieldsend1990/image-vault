# Article 1 — Fourteen weeks, 490 pull requests: building likeness infrastructure in the open

**Purpose:** The canonical build-story link that Series A posts point back to.
**Notion:** LinkedIn Posts DB · Code `Article 1` · suggested Week 9

---

# DRAFT — LinkedIn Article

**Title: Fourteen weeks, 490 pull requests: building likeness infrastructure in the open**

Fourteen weeks ago, our PR #1 was a password-reset flow.

Since 2 April we've merged 490 pull requests across two repositories, and the product they add up to is live at imagevault.ai: consent, custody, and royalty infrastructure for performer likeness data. This is the whole arc, compressed — including the three moments that changed what we were building.

**The problem: scans everywhere, custody nowhere.**

A modern scan package is 200 GB to a full terabyte. Face, body, movement — captured at a specific age, for a specific production. On most productions it ends up on whatever drive the vendor left it on, and after wrap the deal ends but the data doesn't. The performer has no visibility, the production holds pure liability, and nobody can produce a record when the rights question resurfaces three years later.

That's what we set out to fix: a canonical archive where the performer is the rights-holder, and nothing moves without consent, evidence, and — where the deal calls for it — payment.

**Weeks 1–3: the boring parts, deliberately.**

Before anything clever: password recovery, sessions, mandatory 2FA for every role. Then the audit log — where we found, in week one, that our edge runtime was silently dropping async writes. For a chain-of-custody product, an audit trail that loses entries is an extinction-level bug. We fixed it before building anything that depended on it, and "audit-first" quietly became the house style.

The signature mechanism landed early too: dual-custody download. No file leaves the vault unless two different people, on two different sides of the deal, each pass 2FA — the licensee initiates with their code, the talent or their rep authorises with theirs, and a time-limited token releases exactly one download. Structural, not policy.

We also gave the platform an AI layer and capped it at $1.00 per fortnight. Hard ceiling, enforced in code, every call cost-logged, free fallback model. Judgement, not spend.

**Weeks 4–8: enforcement follows the file.**

Storage is table stakes; the product is what happens after the download. So we built the Render Bridge: a cooperative agent on the licensee's own infrastructure where the project grant is the single source of truth. Licence revoked at 14:02, files deleted from the vendor's render share at 14:02:30. Anything on disk not in the current grant is unlicensed and gets purged.

Then geometry fingerprinting: move 640 vertices by two hundredths of a millimetre and you've signed a 3D scan — invisibly, permanently, per licensee. A leaked mesh becomes a confidence-ranked attribution to the exact licence. "We logged the download" became "we can name the leaker." (Making that run on 3 GB files inside 128 MB of memory took twenty PRs of streaming work. Worth every one.)

**Inflection one: the union agreement changed our roadmap.**

On 30 May we merged a PR with no code in it — a strategic read of Article 39 of the new SAG-AFTRA agreement. The uncomfortable clause is 39.A: producers can create a digital replica from footage alone, no scan session required. That erodes every "we hold the file" security pitch, including ours.

The durable position isn't storage. It's the consent, audit, and royalty layer. Because we'd been audit-first since week one, consent was already an event stream — so we could absorb the pivot instead of rebuilding. Within three weeks we had a per-use royalty meter, a hash-chained compliance ledger where every event seals the one before, and a one-click Article 39 compliance certificate sealed with the ledger tip hash.

**Inflection two: the industry is a graph, not a pair.**

Likeness data doesn't move between one talent and one studio. It moves through an ecosystem: producers, VFX vendors, sub-vendors, scan companies, unions, insurers. On 13 June, seven PRs in one day gave each of them a scoped, revocable place in the system — including a read-only watcher role for unions and insurers: oversight without custody.

(Growth had its own comedy. At route #288 our deploy artifact hit a hard 25 MiB platform limit — every new feature made the product undeployable. The fix collapsed 288 route functions into one 2.35 MiB Worker. Zero downtime, no data migration.)

**Inflection three: opening to the AI web.**

The last fortnight made consent machine-readable. A performer's public posture — red, amber, green, derived from their standing instructions, red by default — is now crawlable via license.xml. An AI company's crawler can discover terms, request a licence, and, if the posture is green, be auto-granted at the talent's own rate card with a metered key. Amber routes to a human. Red just says no. Granted requests become real, revocable, metered licences.

Consent for the AI web, on the performer's terms.

**What we'd tell ourselves at PR #1.**

Three things. Audit-first pays off the day compliance becomes the product — you can't retrofit evidence. The plot twist you can't predict (for us, Article 39) is survivable if consent is already an event stream. And honesty about what you're *not* — we deleted "zero-knowledge" from our own spec, and we say plainly that the Bridge is custody and evidence, not copy-proof DRM — is what keeps the rest credible.

Fourteen weeks. 490 pull requests. The vault was phase one; the consent rail is the point.

*We're building Image Vault in the open — the DMs are open too, especially if you're a production, rep, or vendor wrestling with any of this.*

---

**Posting notes:** publish under Luke's byline. Companion short post: A24 (the retrospective carousel) links here. Image: deck-slide-1.png. Series A posts should all link back to this once live. No union logos; no client implications.
