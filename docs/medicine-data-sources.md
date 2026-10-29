# Medicine reference data: research & recommendation

This document is the result of researching real, legitimate sources for the
`medicine_reference` table (see `server/prisma/schema.prisma`). It exists so
the project is honest about what data is actually available, from where,
at what cost, and with what coverage of the Pakistani market — rather than
claiming a comprehensive database that hasn't actually been built.

**Current state of the seed data:** `server/prisma/seed.ts` inserts ~10
well-known generic medicines (name/strength/form only) as a **manually
curated, unverified demo set** (`dataProvenance: MANUAL`,
`verificationStatus: UNVERIFIED`, no price). This exists only so the UI has
something to render locally. It is not a real data import and must not be
described as one.

## Sources investigated

### 1. DRAP (Drug Regulatory Authority of Pakistan) — the most relevant source, but no official API

- **What it has:** DRAP publishes a public "Registered Product Data" lookup
  at `eapp.dra.gov.pk/WebProductIndex.php`, covering brand name, dosage
  form, composition/active ingredients, registration number, registration
  date, and the manufacturer/marketing-authorization holder. DRAP has also
  referenced a provisional database of ~60,000 registered medicines.
  Source: [DRAP e-Services Portal](https://e.dra.gov.pk/), [Registered Product Data](https://eapp.dra.gov.pk/WebProductIndex.php).
- **Pricing:** DRAP separately regulates maximum retail prices. A
  third-party aggregator ("PharmaPrice Index") packages DRAP's price data
  as JSON, but this is **not an official DRAP API** — it's a third party
  re-publishing DRAP's public price notifications.
- **API access:** None found. It's a web lookup form, not a documented,
  authenticated API.
- **Coverage of Pakistan:** By far the most relevant source for this
  product's target market — it's the actual national registry.
- **Cost:** The public lookup is free to use in a browser; there is no
  paid official API to subscribe to (because there isn't an official API).
- **Recommendation:** **Do not scrape `eapp.dra.gov.pk` or `e.dra.gov.pk`
  without first confirming DRAP's terms of use explicitly permit it.** I
  could not find a published robots.txt/ToS statement either allowing or
  forbidding automated access during this research pass — that has to be
  resolved (e.g. by contacting DRAP, or finding/confirming written terms)
  before any automated import is built. Until that's confirmed, the
  practical path is: **manual/CSV-based curation** of a priority list of
  commonly prescribed medicines (verified by a person against the public
  lookup, with the registration number and lookup date recorded per
  entry), imported via `MedicineReferenceSource` rows with
  `sourceName: "DRAP"` and the retrieval date. This keeps the data
  genuinely Pakistan-relevant without an unauthorized scrape.

### 2. OpenFDA (US FDA) — good for drug/label data, not Pakistan-specific

- **What it has:** Free, public, key-free-for-low-volume REST API.
  `/drug/label.json` gives structured labeling (warnings, interactions,
  contraindications, dosage sections); `/drug/ndc.json` gives the US
  National Drug Code directory (generic/brand name, manufacturer, dosage
  form, route, active ingredients), updated daily.
  Source: [open.fda.gov](https://open.fda.gov/apis/drug).
- **API access:** Free, no license agreement; 40 req/min unauthenticated,
  higher with a free API key.
- **Coverage of Pakistan:** None — this is **US-market** data (FDA
  approvals). It is useful for generic drug-class information (active
  ingredient, formulation, standard warnings) but **must never be
  labeled or implied as Pakistani** — which matches this project's
  `countryOrMarket` field being explicit and required to be accurate.
- **Recommendation:** Use as a supplementary source for ingredient-level
  reference facts (interactions/warnings text, standard formulations),
  tagged `dataProvenance: OPENFDA`, `countryOrMarket: "United States"`.
  Good, free, well-documented, and safe to automate (official API, not a
  scrape).

### 3. WHO Model List of Essential Medicines (EML)

- **What it has:** The WHO's ~24th list (2025) of essential medicines with
  INN (generic) names and ATC classification, periodically updated.
  Source: [WHO EML](https://www.who.int/groups/expert-committee-on-selection-and-use-of-essential-medicines/essential-medicines-lists).
- **API access:** No official WHO API for the EML dataset itself; the list
  is published as PDF/structured documents. Third-party scrapers exist
  (e.g. on Apify) but those are unofficial and come with their own terms.
- **Coverage of Pakistan:** Global/normative, not country-specific — it's
  a "what's essential" list, not a Pakistani registry or price list.
- **Recommendation:** Good as a **generic-name and classification
  backbone** (which generics exist, their ATC class) to decide which
  medicines are worth prioritizing for manual DRAP verification — not as
  a source of Pakistani brand names, registration numbers, or prices.

### 4. RxNorm (US National Library of Medicine)

- **What it has:** Free, key-free API (`rxnav.nlm.nih.gov/REST/`) for
  normalizing drug names — mapping brand ↔ generic, resolving ingredients
  and strengths to a stable RxCUI identifier, fuzzy-matching misspelled
  names. 20 req/sec, no key required.
- **Coverage of Pakistan:** None directly (it's a US nomenclature
  standard), but it's useful as a **name-normalization layer** — e.g.
  catching that "Panadol" and "Paracetamol" and "Acetaminophen" should
  resolve to the same ingredient concept — independent of market.
- **Recommendation:** Good candidate for a later "did you mean"/fuzzy
  search improvement on top of whatever primary dataset is loaded; not a
  primary data source.

## Recommended approach (in order)

1. **Manual, verified seeding for the Pakistani market (near-term).**
   A person looks up each medicine on DRAP's public registry, records the
   registration number + retrieval date, and a `MedicineReferenceSource`
   row is created with `sourceName: "DRAP"`, `sourceUrl` pointing at the
   specific lookup, and `retrievedAt` set to that date. Slow, but the only
   approach that's both accurate and clearly within terms of use without
   DRAP's explicit sign-off on automation.
2. **OpenFDA import for ingredient-level reference facts (near-term,
   automatable today).** A scheduled job (not yet built) could pull
   `/drug/label.json` and `/drug/ndc.json` for common generics and store
   them tagged `OPENFDA` / `United States` — useful supplementary
   information, never presented as Pakistani.
3. **WHO EML as a prioritization list, not a data source.** Use it to
   decide which ~100-300 generics matter most for step 1, rather than
   importing it wholesale.
4. **Revisit DRAP automation only after confirming terms.** If DRAP (or a
   partner) confirms an acceptable automated-access path — an official
   API, a bulk data license, or written permission for polite scraping —
   switch step 1 from manual entry to a scheduled importer. This is a
   business/legal step, not just an engineering one, so it needs a
   decision from the project owner, not just a code change.
5. **Never fabricate a price.** Every `MedicineReference.referencePrice`
   must carry a `priceSource`, `priceSourceUrl`, and
   `priceLastVerifiedAt`. Where none of those exist, the field stays
   `null` and the UI shows "No verified price available." — this is
   enforced by the schema (nullable price fields) and the frontend
   (`MedicineInformation.tsx`), not just a convention.

## What this means for "coverage" claims

As of this stage, the reference database has **not** been populated with
real, verified Pakistani medicine data — only a ~10-item manual demo set
with no prices. Any claim of "comprehensive" or "verified" coverage would
be false until step 1 above is actually carried out and measured (e.g.
"312 of the ~400 generics on the national EML priority list are verified
as of 2026-XX-XX"). Track that count here once real import work begins.

---

# Decision record — 29 October 2026

This section supersedes the recommendations above where they conflict. It
records what was investigated, what was decided, and **what is actually
implemented in the running application**.

## What the application uses today

| Need | Source | Status | Permitted? |
|---|---|---|---|
| Medicine label information (uses, side effects, warnings) | **openFDA drug label API** | **Live and working** | **Yes** — documented public API, U.S. Government public domain, no API key |
| Pakistani prices | *none* | **Honest "Verified price unavailable"** | No permitted source secured |
| Pakistani product leaflets | *none* | Not shown | No permitted source secured |

### openFDA — implemented

`server/src/services/medicineInfo/openFdaClient.ts` queries
`https://api.fda.gov/drug/label.json` live, per active ingredient, and caches
results in `medicine_monographs` (30 days; misses cached 7 days).

- **Licensing:** openFDA data is U.S. Government work in the public domain.
  No key is required at this volume (openFDA's documented limit is 240
  requests/minute, 1,000/day unauthenticated).
- **Critical limitation, surfaced in the UI:** this is **United States**
  labelling for the *ingredient*. It is **not** the Pakistani leaflet for a
  Pakistani brand. Approved indications, pack sizes and wording can differ.
  Every monograph row carries `market: US`, the detail page prints an
  explicit notice above the text, and Scripty attaches a `marketNote`.
- **Matching safety:** a phrase search for `amoxicillin` also matches
  *amoxicillin and clavulanate potassium* — a different medicine.
  `pickBestLabel()` requires the label's generic name to BE the ingredient
  (or a salt-form variant of it) and returns nothing rather than the wrong
  leaflet. Covered by `tests/medicineInformation.test.ts`.

## Pakistani price sources — investigated, NOT used

Both sites named in the brief were fetched and read directly (robots.txt,
terms, about/method pages, index pages and an individual medicine page).

### medira.pk

- `robots.txt`: `User-agent: *` / `Allow: /`, no `Disallow` lines, sitemap
  published. **No robots-level restriction.**
- Terms of use: **silent** on scraping, crawling, automated access, data
  reuse and database IP. The nearest clause is an "Acceptable use" line
  about not interfering with the service.
- Scale: claims 17,161 medicines. Detail pages carry brand, generic,
  manufacturer, **DRAP registration number**, pack size, per-unit and pack
  price, and a **price effective date** — genuinely the fields this schema
  wants.
- **No API, no dataset download, no data licence.** `/api` returns 404.
- Self-declared provenance: prices and registration numbers **from DRAP**;
  leaflets built from **US FDA labels and MedlinePlus**.

### dawacheck.pk

- `robots.txt`: permissive for generic agents, **but** explicitly
  `Disallow: /` for `ClaudeBot`, `anthropic-ai` and `Claude-Web`, and sets
  Cloudflare Content Signals `ai-train=no, use=reference` — framed as an
  express reservation of rights.
- Terms of use, §4 "Fair use", verbatim: *"Don't copy the whole database to
  resell it or run a competing service, and don't overload the site with
  automated requests."*
- Scale: 9,469 brands / 21,551 packs. Price, pack size, DRAP registration
  number, effective date. **No clinical content at all** — it is a price and
  recall database, not a drug-information database.
- **No API, no dataset download, no data licence.**
- Self-declared provenance: transcribed from **DRAP's** published price list
  and alert notices.

### Why neither is used

1. **The underlying data is DRAP's**, not the republishers'. The project
   owner has explicitly withheld approval for a DRAP import pending
   confirmation that reuse is permitted. Taking the same data via an
   intermediary does not change that question — it only obscures it.
2. **Neither site offers an API, export, or licence.** Any integration would
   be HTML scraping of pages whose terms either forbid wholesale copying
   (dawacheck) or are an explicitly unreviewed draft that "may change before
   launch" (medira).
3. **dawacheck.pk names Anthropic's crawlers in `robots.txt`.** Regardless of
   what a generic user-agent is technically allowed to do, that is a clearly
   expressed wish, and working around it by changing the user-agent string
   would be dishonest.

**Result:** `price.service.ts` imports nothing. It reads only prices already
present in `medicine_reference`, and otherwise returns an explicit
`UNAVAILABLE` status with outbound links so the user can check DRAP,
medira.pk or dawacheck.pk themselves. **Linking out is not reuse.**

## How to enable real prices later

1. Obtain written permission from DRAP (or an official dataset/notification
   file), or written permission from one of the republishers.
2. Write an importer that populates, **together and never partially**:
   `referencePrice`, `currency`, `packSize`, `priceType`
   (`OFFICIAL_MRP` vs `RETAILER_LISTED`), `priceSource`, `priceSourceUrl`,
   `priceEffectiveFrom`, `countryOrMarket: "Pakistan"`.
3. Nothing in `price.service.ts` or the UI needs to change — both already
   render verified prices, strict strength/form/pack matching, price type
   and effective dates. The only reason they show "unavailable" today is
   that there are no rows to show.

---

# Addendum — 29 October 2026 (price sources re-checked)

Re-read today: dawacheck.pk (home, `/terms`, `/api`, `/about`),
dra.gov.pk (home and its pricing links), and medira.pk (`/terms`, `/about`).

| Source | Authorised machine access? | Terms on reuse in another app | Provenance |
|---|---|---|---|
| **DRAP Drug Pricing Index** — `e.dra.gov.pk/public/price` | **No** — searchable HTML table (~1,086 pages; product, registration no., manufacturer, pack size, price, effective-from date). No API, no download link found. | Footer: "© 2026 Drug Regulatory Authority Pakistan. All rights reserved." No terms or licence page found. | Official regulator — the authoritative source. |
| **dawacheck.pk** | **No** — `/api` and `/about` return 404; no data, developer or licence page. | Terms (updated 18 Oct 2026) §4: "Don't copy the whole database to resell it or run a competing service, and don't overload the site with automated requests." Silent on embedding in another app. No partnership contact. | "We copy prices and alerts from DRAP's public documents." |
| **medira.pk** | **No** — no API or licence. | Terms (updated 23 Oct 2026) silent on third-party reuse. Contact: support@medira.pk. | "Maximum retail prices and registration numbers from DRAP." |

**Decision (unchanged): no price data is imported.** DRAP is now
identified as the authoritative source with exactly the fields needed, but
it grants no reuse licence and offers no API, and the project owner's
standing instruction is not to import DRAP data until reuse is confirmed
as permitted. Linking out to DRAP and the two republishers remains the
honest behaviour.

**What changed in the code:**

- `scripts/importPrices.ts` + `docs/price-import-template.csv` — imports
  curated, fully sourced price records (all-or-nothing validation; dry
  run by default). Nothing is fetched from any website.
- `price.service.ts` matching tightened: exact brand/generic name (no
  substring matches — "Panadol" ≠ "Panadol Extra"), exact strength by
  value and unit, dosage form with prescription abbreviations ("Tab." =
  tablet), and no price at all when the strength or form is unknown.
- The UI shows each verified price's source, effective date and
  last-verified date.

**To enable real prices:** ask DRAP's Costing & Pricing division (or a
republisher) for written permission or an official dataset; then
transcribe or import records with `npm run prices:import`.


---

# Addendum — 29 October 2026 (catalogue sources, re-checked and widened)

Read-only review of public pages; nothing was downloaded, scraped or signed
up for, and no one was contacted. "Unverified" marks what could not be confirmed.

| Source | What it publishes | Reuse position | Verdict |
|---|---|---|---|
| DRAP Drug Pricing Index (e.dra.gov.pk/public/price) | Product, reg. no., manufacturer, pack, price, effective date; "page 1 of 1086" at 20/page | No API/export; footer "© 2026 Drug Regulatory Authority Pakistan. All rights reserved." No terms page | **Needs written permission** |
| DRAP Gazette SROs (dra.gov.pk → Costing & Pricing / SROs) | PDF notifications fixing or changing MRPs for named products | Copyright Ordinance 1962 s.57(1)(q): reproducing matter published in the official Gazette is not infringement unless the Government prohibits it | **Usable now**, but partial (changes only) and the newest MRP SRO found is from Aug 2023 |
| DRAP Registered Drugs Index (eapp.dra.gov.pk/WebProductIndex.php) | Brand, form, ingredients, reg. no./date, licence holder | Disclaimer: provisional list that "cannot be used as a reference for any purpose" incl. research; "All Rights Reserved" | **Not usable** without permission |
| dawacheck.pk | ~21,551 DRAP-priced packs, recalls | Terms §4: "Don't copy the whole database to resell it or run a competing service…" | **Not usable** |
| medira.pk | "17,161 medicines with DRAP prices", generic alternatives | Terms silent on reuse; contact support@medira.pk | **Needs written permission** |
| drugsinfo.pk | "66,000+ medicines": brand, composition, pack, MRP, reg. no. | Terms §2: no scraping/redistribution "without prior written permission" | **Needs written permission** |
| dawaai.pk, healthwire.pk, marham.pk, oladoc.com | Retail catalogues, some with photos | Non-commercial/personal use only; copying and scraping prohibited; images claimed as their property | **Not usable** |
| sehat.com.pk, dvago | Retail listings | "All rights reserved" / terms pages 404 (unverified) | **Not usable** without permission |
| Pakistan open-data portals | No DRAP dataset; one unlicensed 2021 Kaggle-derived CSV | No licence | **Not usable** |
| IQVIA Pakistan | Commercial market audit data | Paid licence, price not public | Possible, paid; not an MRP reference |
| Third-party DRAP scrapers (e.g. Apify) | Scraped DRAP index | Does not resolve DRAP's rights | **Avoid** |

**Product images:** no source licenses them. DRAP publishes none; every
pharmacy site claims its photos; packaging belongs to the manufacturer. The
lawful options are manufacturer permission or Scriptly's own photographs of
purchased packs.

**Policy note (from news reports, not the notification itself):** since
February 2024, prices of medicines outside the National Essential Medicines
List are deregulated, so many brands may have no DRAP-fixed MRP. A
DRAP-only catalogue would therefore be incomplete for prices.

**Permission contacts:** DRAP Director Costing & Pricing,
director.costing.pricing@dra.gov.pk, 051-9255359 (copy Director MIS,
addl-directormis@dra.gov.pk). drugsinfo.pk via drugsinfo.pk/contact.
medira.pk via support@medira.pk.

**Decision: nothing imported.** The catalogue code, importers and coverage
report are in place (README §4.3); records arrive when the project owner
chooses a source and, where needed, holds written permission.
