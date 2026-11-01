# Prose review checklists

Questions for the voice review: a subagent reads the prose a change adds and checks it against the checklist for its kind. Vale (`just lint-prose`, `just lint-strings`, `just lint-subjects`) catches word-level habits first. These questions cover what vale can't see: a claim the build doesn't make, a wrong actor, a vague referent, a noun pile.

## How to run a review

1. List the added lines only: `jj diff --git -r <rev>` (or `git diff -U0 <base>`), plus the subjects from `just lint-subjects`. Old text is out of scope, unless a new line copies old text.
2. Sort each added line into a kind below. One file can hold several kinds (a `.py` file has `--help` text, messages and comments).
3. Answer every question for the kind. Read the code behind a claim, and the flag defaults in `src/markup/feature-flags.ts` and the clipper's argument defaults.
4. Before reporting a finding, check the decisions and earlier reviews your brief lists for a decision on the same text or flag.
5. Report each finding as: file and line, the question it fails (kind and number, such as "4.1"), the quoted text, and a rewrite.

Severity:

- **High:** a claim that is false in the default build.
- **Medium:** a wrong condition or default, a wrong actor, a referent with two readings, a missing step, or a term that names something else.
- **Low:** wording, density, a noun pile that still reads correctly.

## 1. Readme reference sections

1. Does each claim match what the default build does, with the exact condition (site, mode, setting, flag default)?
2. Is the subject of each verb something that can do it? Files, plots, data and URLs don't decide, render, clip or compare. The user, the `markup script`, the `clipper script` or YouTube does.
3. Can every "it", "this", "that", "there" and "then" point at only one noun?
4. Does each bullet hold one or two short sentences, with separate actions in nested bullets?
5. Does every sentence change what the user does or how they read the UI? Flag design reasons, internal thresholds, and what users see for themselves.
6. Are the specifics concrete where the user needs them: the actual colors, keys, labels and defaults?
7. Is any noun phrase three nouns long, or an object a clause with "that" dropped?
8. Are the terms the readme's own ("crop point", "hold point", "markers data", "marker pair editor", `markup script`)?
9. Does a new heading have a table of contents entry? (`readme_toc.py` checks this in `just lint-prose`.)

Model lines: "Points with instant easing enabled are darkened." "This is useful if there is a scene change in the video or very fast movement."

## 2. Shortcut entries and descriptions

1. Does the shortcut exist and do this in the default build, with the keys the registry binds?
2. Does the readme entry start with the key in bold and a colon, then a bare verb? Does the description start with a bare verb?
3. Does it name both states of a toggle, or the exact step size?
4. Does the description read alone, as a table row and a palette entry, without an "it" from another row?
5. Does it match the readme sentence for the same feature?
6. Does it describe what the user sees, not the handler ("surfaces", "routing", "dep")?
7. Is any second sentence a real interaction rule (precedence, the mode it needs), not a benefit?

Model line: "**Ctrl+Shift+Click:** Toggle crop point easing between auto and instant."

## 3. Quick start, install and update steps

1. Does each step work as written with the current release's files, folder names and installer?
2. Is each step one action, starting with an imperative verb?
3. Does the goal come before the action when the step has one ("To update, ...")?
4. After a step whose result the user must check, is the visible result stated ("You should see ...")?
5. Is every folder and file named exactly, with no place phrase that has two readings ("next to", "in the same folder")?
6. Are platform differences bold platform lead-ins ("**Windows:**"), not "Windows users"?
7. Are separate facts or options in one paragraph split into bullets?
8. Does the text match `release-notes/updating.md` and the readme for the same step?

## 4. Release notes and changelog subjects

1. Is every claim true of the release's default build, for every choice it lists? A feature behind a flag that defaults off is not in the release notes (its commit is `ifeat` or `ifix`).
2. Does each highlight reuse the readme's wording for the feature, and end with "See [this readme section](...) for the full details."?
3. Is the summary line one plain sentence about the release's main change?
4. Does each subject start with a verb or the area it changes, name options exactly, in backticks, and say what the user notices?
5. Does each `fix` subject say what should happen?
6. Does any subject or highlight use a word that now names something else ("holds" next to hold points)?
7. Does any "which" or "-ing" clause attach to the wrong noun or key?
8. Is any subject a noun pile over about 25 words that should be two `+`-joined changes?

Model subjects: "add `--fast-trim`/`-ft` option to generate outputs quickly without re-encoding". "auto update yt-dlp bundled in frozen releases".

## 5. Clipper `--help` text

1. Is the stated default the one `argparser.py` sets, and does the option do this in the release build?
2. Does the help start with a verb and say what the option does, in user terms?
3. Does it state the default, and the cost or trade-off if there is one?
4. Are the values and choices named exactly, with their scale and direction ("lower is better")?
5. Does it leave out design history, internal names ("Phase 1/2/3", "architecture") and rationale?
6. Is each sentence its own `" ".join` item, ending in a comma?
7. Does an instruction come before the cases it answers?
8. Does it use one name for one thing ("install", not also "release")?

## 6. Tooltips, labels, flash and log messages

1. Is the message true in the default build? Check the flags it depends on, and whether it can show at all with them off.
2. Does an error say what happened, with the value or file, and what to do next?
3. Does a tooltip avoid facts the user must have to finish the task? Those go in the visible UI.
4. Is every term one the user sees in the UI or the readme, not an internal one ("grid", "segments", "intermediate")?
5. Is a debug readout kept out of the release build?
6. Is the actor named (YouTube, the `markup script`, the `clipper script`), not hidden in a passive?
7. Is the message a full sentence, with no " - " or em dash as a separator?

## 7. Code comments and docstrings

1. Does the comment give a why the code doesn't show (a host quirk, an invariant, a magic number's reason), not narrate what it does?
2. Does it describe the code as it is, not the change that made it ("now", "instead of the old")?
3. Is it one line, unless the subject is subtle?
4. Does it name the external reason precisely (browser and version, ffmpeg behavior, spec)?
5. Does it use the literal verb ("shows", "is required"), not a metaphor ("surfaces", "load-bearing")?
6. Does it match the comment density and docstring form of the surrounding file?

## 8. Agent instructions

1. Is each rule a concrete, checkable instruction ("Run `just bundle-prod`"), not a goal ("keep it clean")?
2. Does a rule that needs a reason carry it inline, briefly, so the agent can generalize?
3. Does it say what to do, as well as what to avoid?
4. Is emphasis (caps, "CRITICAL", "MUST") kept for real hard limits, and are rules that must never bend enforced by a hook?
5. Does it add only what the agent can't see from the code?
6. Is it in the right file: always-on rules inline in the root file, situational ones in a scoped rules file?
7. Does it repeat or contradict a rule elsewhere (the project instructions, `.claude/rules/`, the user's global rules)?
8. Is it free of em dashes (`just lint-prose-agents`), and is the file under about 200 lines?
