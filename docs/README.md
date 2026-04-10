# Shunya Protocol — Documentation

This folder is the long-form companion to [`../shunya_prd.md`](../shunya_prd.md).
The PRD tells you **what** to build and in **what order**; these docs tell you
**how it works**, **why we chose each piece**, and **what to do when something
breaks**.

Read in order the first time. After that, treat it as a reference.

| # | Doc | Read when |
|---|---|---|
| 00 | [Overview](00-overview.md) | Onboarding. What Shunya is and why it exists. |
| 01 | [System Architecture](01-system-architecture.md) | You need the big picture — components, boundaries, data flow. |
| 02 | [Verification Flow (Deep Dive)](02-verification-flow.md) | You're touching anything in the proof → attestation path. |
| 03 | [Data Model](03-data-model.md) | You're writing a migration or a query. |
| 04 | [Tech Stack & Rationale](04-tech-stack.md) | You're wondering "why this and not that?" |
| 05 | [SDK Design](05-sdk-design.md) | You're building or integrating the B2B SDK. |
| 06 | [Wallets & Gas](06-wallets-and-gas.md) | You're working on the Coinbase CDP / Base integration. |
| 07 | [ZK Circuits](07-zk-circuits.md) | You're modifying the anon-aadhaar fork. |
| 08 | [zkVerify & EAS](08-zkverify-and-eas.md) | You're touching the verification/attestation middleware. |
| 09 | [Security & Privacy](09-security-and-privacy.md) | You're reviewing data handling, legal, or PII concerns. |
| 10 | [Scalability](10-scalability.md) | You're planning capacity or fixing a bottleneck. |
| 11 | [Decisions Log (ADRs)](11-decisions-log.md) | You want to know why a past decision was made. |
| 12 | [Glossary](12-glossary.md) | You hit a term you don't recognise. |

> **Convention.** When these docs and the PRD disagree, the **PRD wins** —
> it's the source of truth for scope and phases. Docs get updated to match.
