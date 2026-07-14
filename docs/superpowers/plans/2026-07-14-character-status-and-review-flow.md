# Character Status and Review Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a searchable stage-based character status board, automatic review progression, and an easier-to-reach new-learning next button.

**Architecture:** Put stage labels, counts, filtering, progress, and due-copy in a small pure JavaScript module so Node tests can cover the rules directly. Render those results in a focused client component inside the parent center. Keep session navigation in `LiteracyApp`, with pure review timing/navigation helpers and a single managed timer; limit `WordStudyCard` changes to its action layout.

**Tech Stack:** Next.js 16, React 19, TypeScript, Node test runner, CSS, Playwright/Edge, Vercel CLI.

## Global Constraints

- Stage categories are `LEARNING` 待学习, `DAILY` 待复习, `WEEKLY` 每周复习, `TWO_WEEKLY` 每两周复习, and `MASTERED` 已掌握.
- Search and stage filtering must work together across imported and parent-added characters.
- Correct review feedback lasts 700 ms; incorrect feedback lasts 1800 ms; no manual next button remains in review feedback.
- The new-learning “我学好了，下一个” button remains and is sticky/reachable without covering content.
- Learning state remains browser-local under `kids-literacy:v1`; no account or cross-device sync is added.
- Production changes must pass unit tests, rendered/source contracts, lint, Next.js build, iPad browser flow, and Vercel production verification.

---

### Task 1: Character status query model

**Files:**
- Create: `lib/character-status.mjs`
- Create: `tests/character-status.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `STATUS_STAGES`, `getStageCounts(items)`, `filterStatusItems(items, query, stage)`, `getStageProgress(item, settings)`, and `getNextReviewLabel(item)`.
- Consumes: item `stage`, `stageStreak`, `learningCorrect`, and `nextDue`; settings stage goals.

- [ ] **Step 1: Write the failing model tests**

```js
test("maps and counts every learning stage", () => {
  assert.deepEqual(getStageCounts(items), { ALL: 5, LEARNING: 1, DAILY: 1, WEEKLY: 1, TWO_WEEKLY: 1, MASTERED: 1 });
});

test("combines multiple-character search with a stage filter", () => {
  assert.deepEqual(filterStatusItems(items, " 文 花 ", "WEEKLY").map(({ char }) => char), ["文"]);
});

test("describes stage progress and the next review", () => {
  assert.equal(getStageProgress(dailyItem, settings), "连续答对 2/3 次");
  assert.equal(getNextReviewLabel(learningItem), "完成新学后安排");
  assert.equal(getNextReviewLabel(masteredItem), "已完成全部阶段");
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test:unit`

Expected: FAIL because `lib/character-status.mjs` does not exist.

- [ ] **Step 3: Implement the pure status helpers**

```js
export const STATUS_STAGES = [
  { value: "ALL", label: "全部" },
  { value: "LEARNING", label: "待学习" },
  { value: "DAILY", label: "待复习" },
  { value: "WEEKLY", label: "每周复习" },
  { value: "TWO_WEEKLY", label: "每两周复习" },
  { value: "MASTERED", label: "已掌握" },
];

export function filterStatusItems(items, query, stage = "ALL") {
  const wanted = new Set([...query.replace(/\s/g, "")]);
  return items.filter((item) => (stage === "ALL" || item.stage === stage)
    && (wanted.size === 0 || wanted.has(item.char)));
}
```

Implement counts, goal lookup, and due labels directly from the mappings in Global Constraints. Add `tests/character-status.test.mjs` to `test:unit`.

- [ ] **Step 4: Verify GREEN**

Run: `npm run test:unit`

Expected: all model tests pass.

- [ ] **Step 5: Commit**

```powershell
git add package.json lib/character-status.mjs tests/character-status.test.mjs
git commit -m "feat: add character status queries"
```

### Task 2: Searchable status board in the parent center

**Files:**
- Create: `components/CharacterStatusBoard.tsx`
- Modify: `components/ParentPanel.tsx`
- Modify: `app/globals.css`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: `items: LiteracyItem[]`, `settings: LiteracySettings`, and Task 1 status helpers.
- Produces: a read-only status board with search textbox `搜索汉字`, six filter buttons with counts, cards, and an empty result message.

- [ ] **Step 1: Write the failing source/render contract**

Read `CharacterStatusBoard.tsx` and assert that it contains `全部汉字学习情况`, `aria-label="搜索汉字"`, `STATUS_STAGES`, `filterStatusItems`, and `没有找到这个字`; assert `ParentPanel.tsx` renders `<CharacterStatusBoard items={state.items} settings={state.settings} />`.

- [ ] **Step 2: Verify RED**

Run: `npm test`

Expected: FAIL because `components/CharacterStatusBoard.tsx` does not exist.

- [ ] **Step 3: Implement the board and parent-center integration**

```tsx
export function CharacterStatusBoard({ items, settings }: Props) {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<StatusStage>("ALL");
  const counts = getStageCounts(items);
  const visibleItems = filterStatusItems(items, query, stage);
  return <section className="subpanel status-board">{/* search, filters, cards, empty state */}</section>;
}
```

Render the board as a full-width item of `.parent-layout`; use touch-friendly filter pills and a responsive card grid. Every card must expose the character, Chinese stage label, progress, and due label.

- [ ] **Step 4: Verify GREEN**

Run: `npm test`

Expected: unit, build, and rendered/source tests pass.

- [ ] **Step 5: Commit**

```powershell
git add components/CharacterStatusBoard.tsx components/ParentPanel.tsx app/globals.css tests/rendered-html.test.mjs
git commit -m "feat: add searchable character status board"
```

### Task 3: Automatic review progression with reversible decisions

**Files:**
- Create: `lib/review-flow.mjs`
- Create: `tests/review-flow.test.mjs`
- Modify: `components/LiteracyApp.tsx`
- Modify: `tests/rendered-html.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `getReviewFeedbackDelay(correct)` returning `700` or `1800`, and `getNextReviewStep(index, total)` returning `{ done, nextIndex }`.
- `LiteracyApp` consumes those helpers and owns one clearable timer plus `{ state, reviewIndex }` undo snapshot.

- [ ] **Step 1: Write failing timing/navigation tests**

```js
test("uses shorter correct feedback and longer incorrect feedback", () => {
  assert.equal(getReviewFeedbackDelay(true), 700);
  assert.equal(getReviewFeedbackDelay(false), 1800);
});

test("advances or completes a review batch", () => {
  assert.deepEqual(getNextReviewStep(0, 2), { done: false, nextIndex: 1 });
  assert.deepEqual(getNextReviewStep(1, 2), { done: true, nextIndex: 1 });
});
```

Add a source assertion that the review feedback block does not render a button whose text is `下一个`.

- [ ] **Step 2: Verify RED**

Run: `npm test`

Expected: FAIL because the helper module is missing and the current feedback still contains the manual next button.

- [ ] **Step 3: Implement the helper and managed timer**

```tsx
const reviewTimerRef = useRef<number | null>(null);

function answerReview(correct: boolean) {
  // Save both state and current review index before recording the answer.
  // Show feedback, then schedule exactly one advance using getReviewFeedbackDelay.
}

function undo() {
  // Clear the pending timer and restore the saved state and review index.
}
```

Clear the timer before scheduling, on undo, and in an unmount cleanup effect. Remove the feedback `下一个` button while retaining the answer playback button. Finish the last item automatically.

- [ ] **Step 4: Verify GREEN**

Run: `npm test`

Expected: all tests pass and the production bundle succeeds.

- [ ] **Step 5: Commit**

```powershell
git add package.json lib/review-flow.mjs tests/review-flow.test.mjs components/LiteracyApp.tsx tests/rendered-html.test.mjs
git commit -m "feat: streamline review progression"
```

### Task 4: Reachable new-learning action bar and release verification

**Files:**
- Modify: `components/WordStudyCard.tsx`
- Modify: `app/globals.css`
- Modify: `tests/rendered-html.test.mjs`
- Modify: `README.md`
- Create: `output/playwright/verify-status-review-flow.cjs` (ignored verification artifact)

**Interfaces:**
- Produces: `.study-action-bar` containing secondary playback and primary next actions; does not change `WordStudyCard` props or learning queue behavior.

- [ ] **Step 1: Write the failing action-layout contract**

Assert `WordStudyCard.tsx` uses `study-action-bar` and the stylesheet includes `position: sticky`, `bottom:`, and `env(safe-area-inset-bottom)` for that action area.

- [ ] **Step 2: Verify RED**

Run: `npm test`

Expected: FAIL because the new class and sticky action rules do not exist.

- [ ] **Step 3: Implement layout and documentation**

Replace the generic two-column row with `<div className="study-action-bar">`; make the primary next button wider, keep controls visible near the bottom, and reserve spacing so content is never covered. Update README’s implemented features and verification description.

- [ ] **Step 4: Run complete automated verification**

```powershell
npm run test:unit
npm test
npm run lint
npm run build:vercel
```

Expected: every command exits 0.

- [ ] **Step 5: Run the real iPad user script**

At `820x1180`, verify: enter parent center; switch among all six stage filters; search a known character and clear; confirm empty state; enter child review and confirm no next button plus automatic advance; undo one answer; add a new character, start word study, scroll, and confirm the sticky next action stays visible without horizontal overflow or console errors. Save screenshots under `output/playwright/`.

- [ ] **Step 6: Commit and deploy**

```powershell
git add components/WordStudyCard.tsx app/globals.css tests/rendered-html.test.mjs README.md docs/superpowers/plans/2026-07-14-character-status-and-review-flow.md
git commit -m "feat: improve learning action placement"
git push github HEAD:main
vercel --prod --yes
```

- [ ] **Step 7: Verify production**

Inspect `https://kids-literacy-garden.vercel.app`, repeat the key status search and automatic review flow, confirm status `Ready`, HTTP 200, no console errors, no horizontal overflow, and no Vercel error logs from the deployment window.
