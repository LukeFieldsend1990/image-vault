# Article 6 — DRM for a render farm: custody, not copy-protection

**Purpose:** Series H in essay form for the VFX trade audience (fxguide/befores & afters orbit).
**Notion:** LinkedIn Posts DB · Code `Article 6`

---

# DRAFT — LinkedIn Article

**Title: DRM for a render farm: custody, not copy-protection**

Here's a problem every VFX facility now has and few have named: licensed biometric assets on shared infrastructure.

A performer's scan package lands on your render share under a licence with dates, scope, and — since the 2026 agreements — real evidencing obligations. The share is mounted by forty artists and a farm. The licence expires mid-project, or gets renegotiated, or a strike hits. What, technically, happens to the files?

On most pipelines: nothing. Someone remembers, or doesn't. We've spent months building the machinery for a better answer, and this is how it works — including the parts that don't, because that's where the interesting engineering lives.

**The desktop bridge: rights information where the artist works.**

The first component runs on the workstation. DCCs — Nuke, Maya, Houdini — talk only to a localhost bridge; assets arrive as signed manifests whose P-256 signatures are verified on-device against a pinned key. A compromised network path can't inject a forged grant. File hashes are verified locally, and the licence — scope, expiry, permitted uses — is surfaced in a panel next to the asset itself.

That last part matters more than the crypto. Artists don't violate likeness licences out of malice; they violate them because the licence lived in a PDF three departments away. Put the rights where the work happens and most violations never start.

**The render bridge: the share that cleans itself.**

The second component supervises shared storage, and its logic fits in one sentence: the project grant is the single source of truth, and anything on disk not in the current grant is unlicensed and gets deleted.

Grant-omission-equals-purge means revocation isn't a request — it's a state change. Licence revoked at 14:02; at the next heartbeat the reconciler notices the file no longer appears in any grant; it's gone by 14:02:30, and the deletion is logged upstream. Expiry is the same mechanism with a date attached. Nobody on either side has to remember anything.

The hard question is the disconnected case. If the farm loses internet, should the bridge keep serving licensed scans, or destroy them? A network blip shouldn't nuke a shoot's assets; an agent dark for a week shouldn't keep serving possibly-revoked biometrics. We landed on 48 hours of offline grace, then a defensive wipe. Reasonable people can draw that line elsewhere — but the line has to exist, and yours should be written down.

**Honest semantics, because this is where DRM claims usually go to lie.**

Three things we tell every vendor straight:

- **In-flight renders finish; new opens fail.** On Windows/SMB you cannot yank a file out from under an open handle without corrupting the job. Enforcement lands at the next open, the next job, the next heartbeat. That's the right trade-off, and any vendor told otherwise should ask harder questions.
- **A determined insider can copy a file before expiry.** No agent prevents that — full stop. What the bridge does is make the copy *visible*: tamper events, hash mismatches, unexpected-copy detections flow back to the talent's audit feed. The custody layer is also a sensor. (Tuning it was its own saga — our first deployment fired 95 tamper alerts that were all exactly multiples of 4096 bytes. Not an attack: ext4 and APFS disagreeing about block alignment. A tamper detector you don't de-noise is a tamper detector people learn to ignore.)
- **This is cooperative custody, not hardware DRM.** The bridge runs with the facility's cooperation and says so. What it produces is evidence: every access logged and attributable, every deletion attested. "Misuse is logged, attributable, and detectable" is a claim we can defend in a dispute. "Copy-proof" is not, from anyone.

**What the facility gets out of hosting an enforcement agent.**

Nobody installs custody software for the performer's peace of mind alone. The commercial logic:

**Liability transfer.** Holding performer biometrics is risk — special-category data under UK GDPR, isolation obligations under 39.E, "commercially reasonable security" under 39.H that gets defined in court after the leak unless you define it first with evidence. Consuming assets through the bridge moves that burden onto a mechanism built to carry it, with logs you can point to.

**Clean endings.** When a licence ends, the share purges, and a scrub attestation goes on the record within the 14-day window. Provable deletion is the facility's defence when the rights question resurfaces in three years — against a claim that otherwise costs you a discovery process.

**One deal, whole facility.** Org-scoped grants mean any enrolled artist on any enrolled machine works under one commercial agreement — sub-vendors get their own scoped grants — and revocation is still instant across all of it.

**A differentiated pitch.** "We deliver via the Bridge" is becoming a line vendors use with productions: it says the rights follow the file, and the file cleans up after itself.

**The reframe worth stealing.**

Stop asking "how do we stop copies?" — you can't, and everyone selling that is selling theatre. Ask instead: *can we prove custody at every moment of this asset's life, and does the licence enforce itself when nobody's looking?*

Custody, not copy-protection. It's less satisfying on a slide. It's the one that holds up in the dispute.

*Image Vault's Render Bridge is live with pilot vendors — built in the open, honest non-goals included. If you run a pipeline and want to argue about the 48-hour line, genuinely, the DMs are open.*

---

**Posting notes:** publish under Luke's byline; consider cross-posting hooks into VFX communities (fxguide / befores & afters orbit). Image: deck-slide-6.png. Companion short posts: H1/H3/H4 link here. Keep "cooperative custody, not hardware DRM" framing in any excerpt; never "copy-proof".
