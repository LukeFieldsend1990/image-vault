# Article 3 — The case for a neutral likeness custodian

**Purpose:** The Switzerland thesis in full — canonical link for Series E.
**Notion:** LinkedIn Posts DB · Code `Article 3` · suggested Week 6

---

# DRAFT — LinkedIn Article

**Title: The case for a neutral likeness custodian**

Every major production now scans its cast. Face, body, movement — biometric data at terabyte scale, captured under deadline pressure and stored wherever the pipeline happened to put it.

Someone has to hold that data. The industry's answer so far has been "whoever ended up with it" — and that answer is quietly untenable, because every party who might hold it by default is conflicted.

**The studio can't hold it. It's the counterparty.**

A production company holding a performer's scan is the party most incentivised to reuse it — in the sequel, in marketing, in a training set. That isn't an accusation of bad faith; it's a structural observation. Under the 2026 SAG-AFTRA agreement, it's also a liability: 39.E expects biometric data to be isolated with restricted access, and "it's on our production NAS" is the opposite of evidence. Productions we talk to don't actually *want* custody. They want a clean chain of title and someone else's access logs to point to.

**An agency can't hold it. It competes with every other agency.**

A talent agency custodying scans for its own roster is plausible — until a performer changes representation, or a licensee needs data on talent across five agencies, or the agency's commercial interest in a deal collides with its custodial duty to say no. An archive that only works inside one agency's walls isn't infrastructure; it's a lock-in feature. Reps are our users, not our competitors — but the vault itself can't be an agency.

**A hyperscaler won't solve it either.**

Cloud storage is necessary and nowhere near sufficient. A bucket doesn't know what a licence is, can't tell a permitted render from a misuse, and won't testify. The hard part was never storing a terabyte; it's the release mechanics — who may pass, under which licence, with what receipt. Storage without the trust machinery is just a bigger drive to lose track of.

**So neutrality has to be built, and it has to be mechanical.**

"Trust us, we're independent" is a mission statement. Neutrality that means anything is enforced in the mechanics, where you can check it:

- **Dual custody binds the platform too.** No file leaves the vault unless two people, on two sides of the deal, each pass 2FA. There is no admin override that skips the ceremony — which means *we* cannot release your files alone either. Not won't. Can't, without it landing on the record.
- **No representation, no commission on your work, no training on your data.** We take a platform fee on licences concluded through the system. We don't negotiate for you, we don't take a cut of your day rate, and AI training on your data is structurally off by default — the flag can only be switched on by the talent; no request path can create it.
- **Admin is a whitelist hardcoded in the repository.** Changing who administers the platform requires a code commit and a deploy, on the record. A compromised cloud login can't quietly mint an admin. Every admin mutation — including by our own AI tooling — demands a fresh human 2FA code.
- **Every access lands in a tamper-evident ledger.** Append-only, hash-chained, each event sealing the one before. Revocation is a new event, never a deletion. Disputes get settled by evidence, not memory — and the evidence doesn't have a thumb on the scale, because the custodian doesn't profit from either side winning.
- **Published limits.** We deleted "zero-knowledge" from our own spec and said why. We describe the Render Bridge as cooperative custody and evidence, not copy-proof DRM. A neutral party you can't audit — whose security claims you have to take on faith — is just another counterparty.

**Why the first neutral mover sets the standard.**

Custody infrastructure has network economics. The first archive that talent, reps, productions, *and* vendors all trust becomes the default place deals clear — because a licence is only as useful as the counterparties who honour its records. Every scan vaulted, every consent event logged, every scrub attested makes the next deal easier to evidence than the deal done on email and a hard drive. Standards form around whoever shows up neutral first. That is the entire moat, and it only holds as long as the neutrality does — which is why it lives in the mechanics and not the marketing.

**Who holds the keys.**

Strip everything else away and the question is simple. Your face, your body, your movement — captured at 34, usable at 60 — and someone holds the keys.

The studio? The counterparty. Your agency? Until you leave. A cloud bucket? Keys imply someone deciding who passes.

Our answer: the performer holds a key, always — and the custodian's job is to make sure no door opens without it turning. That's not a slogan. It's a 2FA prompt, on your phone, every time anything of yours moves.

Your likeness. Your terms.

*Image Vault is a neutral custodian for performer likeness data — built in the open. If you represent talent, run a production, or hold scan data you'd rather not be liable for, the DMs are open.*

---

**Posting notes:** publish under Luke's byline. Image: deck-slide-7.png ("A neutral custodian for likeness."). Companion short post: E1 links here; E2/E5/E6 reference sections. No agency or union names as clients; United Agents is an aesthetic reference only, never a client claim.
