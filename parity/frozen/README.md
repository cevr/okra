# Recorded TypeScript output

okra was a TypeScript CLI (Bun, Effect) until the Ergo port replaced it. The
parity suites used to run both programs side by side. The TypeScript source is
gone now, so each suite checks the Ergo build against what the TypeScript CLI
printed, exited and wrote. That output was recorded once, at commit 3309dc3
(the last with the source), and is checked in here. The `okra how` records
for counsel, schedule and image later took the same text edit as those skills'
SKILL.md files, which the TypeScript CLI would print the same way.

The repo records were made again from 3309dc3's TypeScript CLI (a `git
archive` of it, with this harness's repo world) once CI showed that the files
git writes into a clone's `.git` followed the host: the reflog named the host's
committer, and git's template set the hooks and their modes. The world now
fixes the committer and uses an empty template, and the remote's path has the
recorded length (see `parity/repo.ts`).

One file per suite and seed: `<suite>-<seed>.json`, with one entry per case
step. The until property also records per host zone:
`until-<seed>-<zone>.json`, where `<zone>` is the host's `/etc/localtime`.
Each entry holds the reference's normalized result: stdout, stderr, status,
and the files and fake-service logs the suite compares. The until entries also
hold the item text and zone, so a check replays the recorded texts rather than
drawing new ones from the checking host's zone lists.

A check fails on a case with no record. A full run (no `--case` or `--only`)
also fails when a record is never used, so the corpus and its records cannot
drift apart.

Recorded seeds:

| Suite                                                           | Seeds | Host zones                                  |
| --------------------------------------------------------------- | ----- | ------------------------------------------- |
| keys and how (`run.ts`), repo, skills, image, counsel, schedule | 42, 7 | any                                         |
| until                                                           | 42, 7 | Etc/UTC                                     |
| until                                                           | 42    | America/Toronto (link), Asia/Kolkata (copy) |

Generated cases now come only from these seeds. A new seed, a new case, or a
change to the CLI's output needs a decision about the expected output, which is
written here by hand and reviewed. There is no oracle left to record from.
