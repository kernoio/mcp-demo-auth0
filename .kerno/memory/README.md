# What Kerno learned

## What this is

This directory holds two kinds of record, and neither is a hand-authored rule. A LESSON is an OBSERVATION: a fact Kerno derived from watching its own endpoint tests finish against your API. An ANALYSIS record is a READING: one section of a document an analysis wrote from your code and from the documentation already in your repository — see "What Kerno read from your code" below. One file is one record.

**Every record Kerno derives lands here, whoever reviewed it, and the record's own header says which.** Nothing is held back waiting for a reviewer, because a record nobody can see is a record nobody reviews. Being in this directory is therefore not an endorsement and not a claim that anyone agreed with it — it is Kerno showing you its working.

**Nothing here is shared until you share it.** These are files in your working tree. They reach nobody else until you commit them and push, which is a control you already operate and can apply per record, per branch, per pull request.

**A record that says an operator reviewed it is DECLARED, not verified.** The role is set by the agent recording the review, and there is no identity at that point for Kerno to check it against. So a header saying `operator` means an agent SAID a human judged this, which is a weaker fact than a human signature and should be read as one. Review the diff on its merits.

## What is used, and what is only shown

Two different questions, with two different answers, and this section exists because conflating them is how a shared instruction file becomes a way to steer future runs.

**What is SHOWN** is everything: every record in this directory, in every review state.

**What is USED** — read back into the context Kerno gives a model when it writes your next test — is decided by the header, and by nothing about this directory. Kerno reads from its own working store, never from these files: editing one changes what you and your reviewers see and changes nothing about what a later run is told. The rule, per state:

- **No `review` in the header** — used, and every line it produces is marked as unreviewed so it cannot read like a checked fact. Review never blocks a run; if it did, a backlog nobody had been shown would quietly switch the feature off.
- **`agreed` or `amended`** — used, and the line says who judged it. On an amendment it is YOUR wording that is used.
- **`disagreed`** — never used again, and that is read off the header rather than off any score, so nothing a later run observes can quietly reinstate it.
- **A withheld capability** — never used as guidance. It is a decision about what Kerno may do, not an observation, and it is consulted when Kerno writes rather than when it reads.
- **A file nothing can parse** — used by nothing. Kerno refuses to guess at a record it cannot read rather than decoding it as something plausible.

So the strongest thing you can do to a claim you do not believe is record a `disagreed` against it. Deleting the file only removes your copy; the disagreement is what stops it being used.

## How to read a record

One record is one `.lesson.md` file: a `---`-fenced header of structured fields, then the claim itself as prose. The header carries what you would judge it by. A lesson's header carries every field below; an analysis record's carries `id`, `scope`, `review` and `removed` and, in place of the rest, the fields named in "What Kerno read from your code".

- `id` — the record's identity, stable across runs. The file name is only an index.
- `scope` — what the record is ABOUT. See the next section.
- `faultClass` — the kind of outcome it was derived from.
- `confidence` — how many independent runs supported it. At 1 it was observed ONCE and is unconfirmed: weigh it as provisional guidance, not as established contract. At 0 a later run contradicted it — the record is kept for the audit trail and is never used again unless fresh evidence re-earns it.
- `evidence` — the endpoints whose runs supported it.
- `review` — the judgement recorded against it: the verdict, the reviewer's own words, when, and the role the recording agent declared. On a correction it also keeps the text that was replaced, so the claim that was wrong stays readable.
- `derivedFrom` — which scenario the claim was read from, and what that scenario observed.
- `learnedAtCodeRef` and `mintedAt` — the commit and the moment it was first recorded.
- `removed: true` — a record Kerno no longer holds. It is kept, and it is never used.

## What a record is about, and how far it reaches

A record's reach comes from the key of the thing it was observed on, never from how often it was seen: a fact seen fifty times is more certain, not more widely applicable. The levels, narrowest first.

- **One endpoint** — one method and path. The narrowest level, and the default.
- **One user flow** — a journey a person named. What it learned is about the sequence, so it reaches that flow's own runs only, never the endpoints it crosses or another flow. The flow still receives the lessons of the endpoints it crosses.
- **Endpoints sharing a trait Kerno derives for every endpoint anyway** (`auth_channel`, `path_prefix`). The widest a record can ever be promoted to.
- **The environment one application runs against** — how it is reached, not what it does.
- **Every endpoint of one application.**
- **Every endpoint of every application in this repository.**

**A narrower record outranks a wider one.** The only thing that widens a record is agreement across separate endpoints that observed the same thing, and that widening stops at the shared-trait level — nothing is promoted to your whole application, or to the whole repository, for having been seen often.

At most 8 records are ever used for any one endpoint. When more than that reach it, the widest and weakest are dropped first.

## How to review one

Three verdicts, and the middle one is the one that matters.

- **agreed** — it matches what you saw. Its standing changes; nothing else does.
- **amended** — it is right about its subject and wrong in what it says. Correct the prose; the original is kept beside the correction. A false record is rarely wholly false, and an accept-or-reject gate would make you throw away a true observation in order to kill a false claim.
- **disagreed** — it should not be taught at all. This is DURABLE: it silences the record without deleting it, the record keeps its identity and its evidence, and the same derivation will not quietly produce it again.

**Silence is not assent.** A record nobody has reviewed is still used by Kerno's own runs, hedged — review must never block a run — but it can never acquire a reviewed record's standing by sitting there. Kerno tells you what is waiting: after every run, the run report names the records with no verdict yet and the single call that records one. An analysis writes no run report; where it tells you is in the next section.

## What Kerno read from your code

An analysis — of your security setup, or of the documentation already in your repository — is written down as one record per section of the document it produced. An application's analysis reaches every endpoint of that application; what your documentation says about the whole repository reaches every endpoint.

You can tell an analysis record by its header: `type: "analysis"`, a `source` naming the document it came from, and a `facet` naming which section of it this is — and no `faultClass`, `confidence`, `evidence` or `derivedFrom`, because it was read, not observed. Its file name starts with `analysis-`.

The rule for what is used is the header rule above, applied to each section on its own: with no `review`, the section is used as the analysis wrote it — nothing marks it, so `kerno_lessons_pending` is where you learn it is waiting; `amended`, and your wording is what the next analysis is handed and what reaches a run; `disagreed`, and it is withheld. A restart does not take an unreviewed section out of use. Kerno first picks the analysis back up as it last wrote it, if the code it read has not changed since; only when it has, or when that copy is gone, does Kerno rebuild the analysis from these records — and then from the sections you `agreed` with or `amended` alone. On either path an unreviewed section stays in use as the analysis wrote it until you judge it.

Your amendment survives a re-analysis. The next analysis is handed your wording; a section it restates in your wording, or in the wording you replaced, keeps your text and your verdict, and only a section it finds changed comes back for review. A section it leaves out is kept as last recorded — nothing is retracted by an analysis alone. When the analysis itself says a section no longer holds, the record carries a `retraction` with the reason and stays in effect until you answer it: `agreed` retires it, `disagreed` keeps it, `amended` keeps it in your wording.

What an analysis leaves waiting is listed by `kerno_lessons_pending` beside the lessons, and judged by `kerno_review_lessons`. The security analysis is named there while it is still computing, and once it is done `kerno_get_state` reports for it how many of its records await a verdict and which sections its latest run left standing without restating. Kerno's own log says the same, one line per analysis that left anything waiting.

## How this gets shared

Like any other change in this repository. The files show up in `git status`; commit them on your working branch, review them in a pull request, merge them.

One record is one file, and that is what makes the merge behave. Two branches that learned about different endpoints merge cleanly. Two that learned CONTRADICTING things about the same endpoint conflict inside one small file — the correct outcome, and a reviewable one: keep the claim that matches what your API actually does, or correct the prose to say the true thing, and keep the header of the side you kept.

Deleting a file here is safe, and it is not how you retire a claim. It removes your copy only; Kerno's own working store is separate and is not touched, so the record is written back on the next run and is used meanwhile. To stop a claim being used, disagree with it.

## Eras

`epoch.json` says which era of Kerno's learning rules these records were written under — currently era 3. When a correction changes how records are derived, the era advances and every record written under the old rules is set aside rather than silently kept.

Nothing is thrown away when that happens. The whole previous store is preserved first, under a ref of its own in this repository — the era before this one is at `refs/memory-archive/calibration-epoch-2` — and the marker that replaces it names that ref and the exact commit it was preserved at, so everything the reset removed can be read back.

## Safety, and its limits

Credential-shaped values are removed from a record's content at the moment the record is written, before it has been committed to anything, and every removal leaves `<credential-redacted>` where the value was. A redaction you cannot see is a deletion, so redactions are visible.

**What that cannot catch, stated plainly rather than glossed:**

- A bare high-entropy string. A 40-character hex run is indistinguishable from a commit hash, and these records legitimately carry commit hashes — removing them would corrupt real provenance to remove a hypothetical secret. They are reported, not removed.
- A passphrase of ordinary words. Nothing about it marks it as a credential.

So the removal is a floor, not a guarantee, and **the reviewer is the last line.** These files are committed to your repository, and a value committed to git history is not removed by deleting the file later.
