# Kids Literacy Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish an iPad-friendly Chinese literacy site that imports the current 649-character learning snapshot, teaches words before isolated recognition, and automatically schedules review stages.

**Architecture:** A single-route vinext/React client application stores one child's progress in versioned `localStorage`. Pure JavaScript modules own selection, repetition, promotion, rollback, import de-duplication, and word-ranking rules so they can be tested with Node's built-in test runner. The UI is a touch-first state machine with separate parent and child controls.

**Tech Stack:** React 19, vinext, TypeScript/TSX, Node test runner, cnchar + cnchar-words, CSS, browser `speechSynthesis`, Sites hosting.

## Global Constraints

- Default batch size is 5, configurable from 1 to 20.
- Default isolated-recognition target is 3 correct readings, configurable from 1 to 10.
- DAILY, WEEKLY, and TWO_WEEKLY require 3 correct due reviews by default; same-day repeats count once.
- A wrong answer in WEEKLY, TWO_WEEKLY, or MASTERED returns the character to LEARNING.
- New and unfamiliar characters must complete word study before isolated recognition.
- Candidate words prefer already learned companion characters, but natural child-friendly vocabulary outranks learned-character coverage.
- Child mode cannot edit settings or source data.
- All primary controls must be usable at 44 CSS pixels or larger and work at iPad portrait and landscape widths.
- First release is one child, one browser/device; no account, analytics, ads, ranking, or cloud sync.

---

### Task 1: Lock the test harness and project shell

**Files:**
- Modify: `package.json`
- Replace: `tests/rendered-html.test.mjs`
- Create: `tests/learning-engine.test.mjs`
- Create: `tests/word-recommendation.test.mjs`

**Interfaces:**
- Produces `npm run test:unit` for pure-domain tests and `npm test` for build plus rendered-page checks.

- [ ] Write rendered HTML assertions for the finished title, mode controls, learning CTA, no starter metadata, and touch viewport metadata.
- [ ] Run `npm test` and verify failure because the starter skeleton is still present.
- [ ] Add empty imports for the wished-for domain APIs so unit tests fail with module-not-found.
- [ ] Run `npm run test:unit` and verify the expected missing-module failure.
- [ ] Commit the test harness with `git commit -m "test: define literacy learning contracts"`.

### Task 2: Implement the pure learning engine and seed import

**Files:**
- Create: `lib/learning-engine.mjs`
- Create: `lib/word-recommendation.mjs`
- Create: `lib/storage.mjs`
- Create: `data/seed-characters.mjs`
- Modify: `tests/learning-engine.test.mjs`
- Modify: `tests/word-recommendation.test.mjs`

**Interfaces:**
- Produces `createInitialState(seed, now)`, `selectLearningBatch(state)`, `recordLearningAnswer(state, characterId, correct)`, `recordReviewAnswer(state, characterId, correct, now)`, `getDueItems(state, now)`, and `mergeImportedCharacters(items)`.
- Produces `rankWords(target, candidates, learnedSet, overrides)` and `getSuggestedWords(target, learnedSet)`.
- Produces `loadState()`, `saveState(state)`, `resetState()` using storage key `kids-literacy:v1`.

- [ ] Test that import removes duplicate entries, rejects `x`, and keeps the least-advanced conflicting stage.
- [ ] Test unfamiliar-first batch selection, configurable batch size, interleaved repetitions, and completion only after the configured correct count.
- [ ] Test daily/weekly/two-weekly promotion, same-day count protection, mastered sampling, and wrong-answer rollback to LEARNING.
- [ ] Test word ranking: natural curated override first, then words whose companion characters are learned, then shorter common candidates.
- [ ] Run the unit tests and verify they fail for missing behavior.
- [ ] Implement only the pure functions needed by the tests, run until green, then refactor without changing behavior.
- [ ] Generate the seed module from the three source groups, preserving 649 unique Chinese characters and recording import warnings.
- [ ] Commit with `git commit -m "feat: add literacy learning engine"`.

### Task 3: Build the parent and child learning experience

**Files:**
- Create: `components/LiteracyApp.tsx`
- Create: `components/WordStudyCard.tsx`
- Create: `components/RecognitionCard.tsx`
- Create: `components/ParentPanel.tsx`
- Replace: `app/page.tsx`
- Replace: `app/globals.css`
- Modify: `app/layout.tsx`
- Delete: `app/_sites-preview/SkeletonPreview.tsx`
- Delete: `app/_sites-preview/preview.css`

**Interfaces:**
- Consumes the Task 2 APIs without duplicating state transitions in React components.
- Produces one client application with views `home`, `preview`, `study`, `recognition`, `review`, `summary`, and `parent`.

- [ ] Keep the rendered-page test red while replacing starter metadata and content.
- [ ] Implement a calm cream/blue visual system, 64-pixel primary controls, safe-area padding, and responsive two-column parent layout that collapses to one column below 760px.
- [ ] Implement parent mode: change this-session/default batch size and repetitions, add characters, edit/hide suggested words, undo the last answer, and reset local progress with confirmation.
- [ ] Implement child mode: word study, speech playback, isolated character card, “我会” and “再学一下”, progress feedback, and completion summary.
- [ ] Use `speechSynthesis` for optional pronunciation; never make audio availability block learning.
- [ ] Run `npm test`, fix build/render failures, and commit with `git commit -m "feat: build iPad literacy experience"`.

### Task 4: Complete content quality and recovery behavior

**Files:**
- Create: `data/word-overrides.mjs`
- Modify: `lib/word-recommendation.mjs`
- Modify: `components/LiteracyApp.tsx`
- Modify: `README.md`
- Add tests to both domain test files.

**Interfaces:**
- Provides 2-3 suggestions for every valid seed character via curated overrides plus `cnchar-words` fallback.
- Preserves parent edits and hides across reloads.

- [ ] Add `cnchar` and `cnchar-words`; build a candidate adapter that never blocks rendering when a dictionary lookup is empty.
- [ ] Add child-suitable overrides for common and ambiguous characters, including `情`, `清`, `词`, `桥`, and polyphonic examples.
- [ ] Test that every seed character returns at least one suggestion and that parent overrides survive serialization.
- [ ] Test interruption recovery: reload retains completed readings and resumes only unfinished characters.
- [ ] Update the README with local run, data-locality, backup/reset, and deployment behavior.
- [ ] Run the full suite and commit with `git commit -m "feat: complete word study content"`.

### Task 5: Verify the real user journeys and publish

**Files:**
- Create: `tests/e2e/literacy.spec.mjs`
- Modify: `.openai/hosting.json` only with the Sites `project_id` returned by site creation.

**Interfaces:**
- Produces a deployable `dist/server/index.js` and a production Sites URL.

- [ ] Run the real parent script at iPad portrait size: enter parent mode, set 5 words and 3 readings, study words, mark one wrong, finish three independent correct readings, and confirm DAILY status.
- [ ] Reload and confirm progress recovery; run child review and verify answer feedback, stage update, and failure recovery.
- [ ] Run at iPad landscape size and verify no clipped content, horizontal overflow, or controls smaller than 44px.
- [ ] Run `npm test`, `npm run lint`, and `npm run build`; require clean success.
- [ ] Create the Sites project once, persist its opaque `project_id`, push the exact committed source, package the successful build, save one version, and deploy privately when owner-only access is verified.
- [ ] Poll deployment status to success, open the production URL, repeat the two smoke journeys online, and record the URL in the final handoff.

