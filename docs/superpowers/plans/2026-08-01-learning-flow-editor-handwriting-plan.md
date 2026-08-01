# Learning Flow, Character Editor, and Handwriting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现答题即时推进、单字编辑、手写画板以及学习进度自动保存与文件备份恢复。

**Architecture:** 保留 `LiteracyApp` 的单一顶层状态，以纯函数负责状态切换和备份校验，以独立 React 组件负责汉字编辑与画板。即时推进在事件处理器内同步计算，所有状态变更继续通过现有 `saveState` 自动持久化。

**Tech Stack:** Next.js 16、React 19、TypeScript、原生 Canvas Pointer Events、Node.js 内置测试。

## Global Constraints

- 不增加第三方依赖，不引入新路由、账号系统或云同步。
- 四种判断按钮点击后不显示反馈、不等待定时器，立即进入下一字或总结。
- 汉字状态切换必须清零计数与复习日期。
- 笔迹只用于当前字练习，换字自动清空，不进入备份。
- 导入失败或取消时不得修改当前进度；成功导入前必须确认覆盖。
- 所有用户可见变化同步更新 `README.md` 与 `CLAUDE.md`。

---

### Task 1: 单字状态切换业务函数

**Files:**
- Modify: `lib/learning-engine.mjs`
- Modify: `tests/learning-engine.test.mjs`

**Interfaces:**
- Consumes: `LiteracyState` 兼容对象、字符 ID、目标阶段 `"LEARNING" | "MASTERED"`。
- Produces: `setCharacterLearningStage(state, characterId, stage)`，返回克隆后的新状态。

- [ ] **Step 1: 写失败测试**

```js
test("sets a character to mastered and clears stale progress", () => {
  const state = createInitialState([{ char: "桥", stage: "WEEKLY", stageStreak: 2, learningCorrect: 1, unfamiliar: true, lastCountedDate: "2026-07-31", nextDue: "2026-08-07" }]);
  const next = setCharacterLearningStage(state, "桥", "MASTERED");
  assert.deepEqual(next.items[0], { ...next.items[0], stage: "MASTERED", stageStreak: 0, learningCorrect: 0, unfamiliar: false, lastCountedDate: null, nextDue: null });
  assert.equal(state.items[0].stage, "WEEKLY");
});

test("sets a character to new learning and clears stale progress", () => {
  const state = createInitialState([{ char: "桥", stage: "MASTERED", stageStreak: 2, learningCorrect: 2, unfamiliar: false }]);
  const next = setCharacterLearningStage(state, "桥", "LEARNING");
  assert.equal(next.items[0].stage, "LEARNING");
  assert.equal(next.items[0].unfamiliar, true);
  assert.equal(next.items[0].stageStreak, 0);
  assert.equal(next.items[0].learningCorrect, 0);
});
```

- [ ] **Step 2: 运行测试并确认因缺少导出而失败**

Run: `node --test tests/learning-engine.test.mjs`
Expected: FAIL，提示 `setCharacterLearningStage` 未导出。

- [ ] **Step 3: 写最小实现**

```js
export function setCharacterLearningStage(state, characterId, stage) {
  const next = cloneState(state);
  const item = next.items.find((candidate) => candidate.id === characterId || candidate.char === characterId);
  if (!item || !["LEARNING", "MASTERED"].includes(stage)) return next;
  Object.assign(item, {
    stage,
    stageStreak: 0,
    learningCorrect: 0,
    unfamiliar: stage === "LEARNING",
    lastCountedDate: null,
    nextDue: null,
  });
  return next;
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `node --test tests/learning-engine.test.mjs`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add lib/learning-engine.mjs tests/learning-engine.test.mjs
git commit -m "feat: support editing character learning stage"
```

### Task 2: 进度备份序列化与安全导入

**Files:**
- Modify: `lib/storage.mjs`
- Create: `tests/storage.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `serializeState(state): string`。
- Produces: `parseImportedState(text): LiteracyState`；失败时抛出中文 `Error`。

- [ ] **Step 1: 写失败测试**

```js
test("round-trips a valid learning state", () => {
  const state = createInitialState([{ char: "桥", stage: "LEARNING" }], new Date("2026-08-01T00:00:00+08:00"));
  assert.deepEqual(parseImportedState(serializeState(state)), state);
});

test("rejects malformed or unsupported backups", () => {
  assert.throws(() => parseImportedState("not json"), /无法读取/);
  assert.throws(() => parseImportedState(JSON.stringify({ version: 2, items: [] })), /版本/);
  assert.throws(() => parseImportedState(JSON.stringify({ version: 1, settings: {}, items: [{ char: 1 }] })), /格式/);
});
```

- [ ] **Step 2: 运行测试并确认缺少接口**

Run: `node --test tests/storage.test.mjs`
Expected: FAIL，提示序列化或解析函数未导出。

- [ ] **Step 3: 实现严格但兼容当前版本的校验**

```js
export function serializeState(state) {
  return JSON.stringify(state, null, 2);
}

export function parseImportedState(text) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error("无法读取这个进度文件。"); }
  if (value?.version !== 1) throw new Error("不支持这个进度文件版本。");
  if (!value.settings || !Array.isArray(value.items) || !Array.isArray(value.history) || !Array.isArray(value.importWarnings)) {
    throw new Error("进度文件格式不完整。");
  }
  if (value.items.some((item) => typeof item?.char !== "string" || typeof item?.stage !== "string")) {
    throw new Error("进度文件中的汉字数据格式不正确。");
  }
  return value;
}
```

- [ ] **Step 4: 把新测试加入 `test:unit` 并运行**

Run: `npm run test:unit`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add lib/storage.mjs tests/storage.test.mjs package.json
git commit -m "feat: add progress backup validation"
```

### Task 3: 答题即时推进

**Files:**
- Modify: `lib/review-flow.mjs`
- Modify: `tests/review-flow.test.mjs`
- Modify: `components/LiteracyApp.tsx`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Produces: `getNextLearningStep(index, queue, characterId, correct)`，返回 `{ done, nextIndex, queue }`。
- Reuses: `getNextReviewStep(index, total)`。

- [ ] **Step 1: 写失败测试**

```js
test("advances learning immediately and requeues an incorrect character", () => {
  assert.deepEqual(getNextLearningStep(0, ["桥", "花"], "桥", true), { done: false, nextIndex: 1, queue: ["桥", "花"] });
  assert.deepEqual(getNextLearningStep(1, ["桥", "花"], "花", false), { done: false, nextIndex: 2, queue: ["桥", "花", "花"] });
  assert.deepEqual(getNextLearningStep(1, ["桥", "花"], "花", true), { done: true, nextIndex: 1, queue: ["桥", "花"] });
});
```

- [ ] **Step 2: 运行测试确认缺少接口**

Run: `node --test tests/review-flow.test.mjs`
Expected: FAIL，提示 `getNextLearningStep` 未导出。

- [ ] **Step 3: 实现纯推进函数并改造组件**

```js
export function getNextLearningStep(index, queue, characterId, correct) {
  const nextQueue = correct ? queue : [...queue, characterId];
  return index + 1 >= nextQueue.length
    ? { done: true, nextIndex: index, queue: nextQueue }
    : { done: false, nextIndex: index + 1, queue: nextQueue };
}
```

在 `LiteracyApp` 中删除 `feedback`、`reviewTimerRef`、两个 `setTimeout` 和反馈 JSX。答题后先更新状态，再同步调用推进函数；最后一题立即进入总结。复习撤销保存答题前状态与索引。

- [ ] **Step 4: 更新现有渲染约束并运行相关测试**

`tests/rendered-html.test.mjs` 保留“无手动下一个按钮”约束，并改为验证构建产物不再包含答题反馈文案或反馈延迟接口。

Run: `npm run test:unit && npm run build && node --test tests/rendered-html.test.mjs`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add lib/review-flow.mjs tests/review-flow.test.mjs components/LiteracyApp.tsx tests/rendered-html.test.mjs
git commit -m "feat: advance immediately after answers"
```

### Task 4: 汉字专用编辑视图与进度文件操作

**Files:**
- Create: `components/CharacterEditor.tsx`
- Modify: `components/CharacterStatusBoard.tsx`
- Modify: `components/ParentPanel.tsx`
- Modify: `app/globals.css`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- `CharacterStatusBoard` 新增 `onEditCharacter(char: string): void`。
- `CharacterEditor` 接收 `state`、`characterId`、`onChange`、`onBack`。
- `ParentPanel` 负责浏览器文件下载、读取、错误消息与覆盖确认。

- [ ] **Step 1: 写失败的渲染契约测试**

增加一个通过生产构建读取 SSR/客户端模块清单的测试，要求家长中心模块引用 `CharacterEditor`，状态卡提供可访问编辑按钮，并出现“导出学习进度”“导入学习进度”操作。

Run: `npm run build && node --test tests/rendered-html.test.mjs`
Expected: FAIL，因为编辑组件和备份操作尚不存在。

- [ ] **Step 2: 实现 `CharacterEditor`**

组件复用 `setCustomWords`、`setCharacterLearningStage` 和现有推荐词逻辑，显示有效词语、添加输入、隐藏按钮、两个状态按钮与“返回汉字列表”。状态按钮直接调用纯业务函数。

- [ ] **Step 3: 连接状态卡和编辑视图**

`CharacterStatusBoard` 将每张卡呈现为唯一可点击按钮；`ParentPanel` 保存 `editingChar`，在列表与编辑视图间切换。

- [ ] **Step 4: 实现导出与导入**

导出使用 `Blob`、`URL.createObjectURL` 和临时 `<a download>`；导入使用隐藏文件输入和 `file.text()`，调用 `parseImportedState`，校验成功后经 `window.confirm` 覆盖。错误写入 `role="alert"`，取消时保持状态不变。

- [ ] **Step 5: 运行单元、构建和渲染测试**

Run: `npm run test:unit && npm run build && node --test tests/rendered-html.test.mjs`
Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add components/CharacterEditor.tsx components/CharacterStatusBoard.tsx components/ParentPanel.tsx app/globals.css tests/rendered-html.test.mjs
git commit -m "feat: add character editor and progress backup UI"
```

### Task 5: 共用手写画板

**Files:**
- Create: `components/HandwritingPad.tsx`
- Modify: `components/LiteracyApp.tsx`
- Modify: `app/globals.css`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- `HandwritingPad({ character }: { character: string })`。
- 组件内部维护折叠、画布上下文、Pointer Capture 和换字清空。

- [ ] **Step 1: 写失败的页面契约测试**

在构建后的客户端模块检查中验证三个学习分支都引用 `HandwritingPad`，并且组件提供 `<canvas aria-label="手写练习画板">` 与“清空画板”按钮。

Run: `npm run build && node --test tests/rendered-html.test.mjs`
Expected: FAIL，因为画板组件不存在。

- [ ] **Step 2: 实现最小画板**

使用 `useRef<HTMLCanvasElement>`、`ResizeObserver` 和 Pointer Events。打开时按 CSS 像素尺寸及 `devicePixelRatio` 设置画布；`pointerdown/move/up/cancel` 绘制圆角深蓝线条；`character` 变化时清空。

- [ ] **Step 3: 接入三个学习视图并添加响应式样式**

在 `study`、`recognition`、`review` 分支各渲染 `HandwritingPad character={当前字}`。画板容器使用现有卡片色和边框，`canvas` 设置 `touch-action: none`，移动端宽度为 100%。

- [ ] **Step 4: 运行构建与渲染测试**

Run: `npm run build && node --test tests/rendered-html.test.mjs`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add components/HandwritingPad.tsx components/LiteracyApp.tsx app/globals.css tests/rendered-html.test.mjs
git commit -m "feat: add handwriting practice pad"
```

### Task 6: 文档、全量验证与真实操作验收

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `design-qa.md` only if browser evidence is captured in this run

**Interfaces:**
- No new code interfaces.

- [ ] **Step 1: 更新用户和开发文档**

README 增加即时推进、汉字编辑、手写画板、自动保存及导入导出使用说明；CLAUDE 增加新组件边界、状态切换规则、备份校验和画板不持久化约束。

- [ ] **Step 2: 全量自动化验证**

Run: `npm test`
Expected: 所有单元、构建和渲染测试 PASS。

Run: `npm run lint`
Expected: exit 0，无 ESLint 错误。

- [ ] **Step 3: 用户操作剧本**

在真实浏览器中依次验证：进入家长中心编辑一个字并刷新；导出后改变状态再导入恢复；三个学习页面打开画板、书写、清空和换字重置；四种判断操作均立即换字且无反馈卡；非法文件导入显示错误且保留进度。

- [ ] **Step 4: 检查工作区并提交文档**

```bash
git diff --check
git status --short
git add README.md CLAUDE.md design-qa.md
git commit -m "docs: document learning tools and backup flow"
```

- [ ] **Step 5: 最终需求核对**

逐条对照设计文档验收标准，记录通过项、浏览器阻塞项以及未纳入提交的既有工作区文件。
