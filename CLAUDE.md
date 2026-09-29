# 项目协作说明

识字小花园面向儿童和陪学家长。功能、运行方式和发布规则以 [README.md](README.md) 为准；本文件补充继续开发需要理解的模块与边界。

## 运行与验证

使用 Node.js 22.22 或更高版本，执行 `npm ci` 安装，`npm run dev` 启动本地服务。验证命令为 `npm run test:unit`、`npm test`、`npm run lint`、`npm run build`；`npm test` 包含生产构建和真实 Node 服务检查。

用户操作剧本在 [tests/user-scenarios.md](tests/user-scenarios.md)。发布版含家庭码登录、服务端 API 与 SQLite，旧本地版本的 45 项测试与静态预览只能作为历史基线；本次变更须验证登录、服务器读写、刷新恢复及离线重试。只记录实际执行结果，未执行项标为待验收。

## 核心模块

- `components/LiteracyApp.tsx`：首页入口、学习页面与账户切换；通过 `usePermanentProgress` 使用当前账户的学习进度，按账户 ID 重建学习页面。
- `components/AccountMenu.tsx`、`lib/learning-accounts.mjs`：账户目录、添加账户及从现有字库生成全新学习进度。
- `components/ParentPanel.tsx`、`CharacterStatusBoard.tsx`：家长中心设置、添加汉字、状态列表与单字删除入口。
- `components/DailyStudyList.tsx`、`lib/study-list.mjs`：今日完整列表、单击学会、双击不会、末尾集中复习和当天队列恢复；本周末手选清单也使用同一业务模块。
- `components/WeekendReview.tsx`、`app/weekend-review.css`：本周末选字、查看详情、复习完成及打印清单；独立打印区与屏幕操作区分开渲染。
- `components/CharacterDetails.tsx`、`CharacterDialog.tsx`、`CharacterEditor.tsx`、`lib/character-editing.mjs`：默认隐藏答案、详情弹窗和统一编辑校验。
- `lib/learning-engine.mjs`：学习阶段、到期时间、答题升级规则；列表答题复用阶段规则。
- `components/usePermanentProgress.ts`、`lib/progress-client.mjs`、`lib/progress-sync.mjs`：浏览器即时保存、认证加载、上传、离线补传和版本冲突处理。
- `lib/progress-state.mjs`、`lib/server/`、`app/api/`：进度校验、家庭码认证、SQLite 持久化及 API。
- `tests/`：业务、同步、服务端和真实用户操作验证；`deploy/`：systemd 服务与备份配置。

## 本次功能约定

- 首页默认列表学习，暂时隐藏孩子自主学习入口，保留家长陪学。
- 今日清单包括所有待学习、到期复习及配置中的掌握抽查字，不受每轮取字数限制。单击延迟约 500 毫秒提交，双击取消对应单击并记录不会；不会字进入末尾集中复习，关闭详情或刷新不得丢失。
- 详情拼音与组词默认隐藏，点击按钮显示；列表和详情共用编辑器。拼音不能为空；每个组词须为包含目标字的 2–4 个汉字；显式留空组词必须保留空数组，不能重新补回推荐词。
- 修改学习阶段重置该阶段计数并重新安排复习日期。手选周末清单独立于“每周复习”阶段，按北京时间周一开始，新周不自动选字。
- 周末清单打印仅包含标题、日期、字数和当前所选汉字，不包含答案、学习状态或操作按钮。空清单禁用打印；使用浏览器原生打印窗口选择打印机或另存 PDF，A4 纵向六列并自动分页。打印不修改 React 页面状态或家庭进度，取消后应保持原界面；验证多页末尾字卡完整，以及展开选字区、打开详情时仍只打印清单。
- `editedWords`、`weekendReview`、`dailySession` 随当前账户的完整状态保存。老进度可缺少这些字段，读写与校验必须兼容；新增字段必须经过服务端校验与持久化测试。
- 单字删除只在家长中心列表“删除”和该中心的详情“删除这个字”提供。确认文案须说明将移除当前账户中该字的拼音组词、学习进度历史、今日队列和周末清单关联项，其他账户不受影响；取消不得修改状态。
- 删除逻辑通过当前账户的完整状态同步，成功后移除列表项、关闭被删字的详情并显示提示。今日队列的待学习、稍后复习和已完成 ID，以及学习历史、周末选字均须清理，不能留下孤立引用；其他汉字的资料和记录保持不变。
- 删除可离线排队，沿用永久同步与冲突保护。允许字库为空，刷新后不得自动补回种子字库；重新添加被删字应走正常添加流程，不恢复旧编辑、成绩、历史或清单。验收须覆盖两账户隔离、取消、删除最后字、重新添加和移动布局。

## 学习账户约定

- 所有账户使用同一个家庭码和家庭登录会话。原有账户固定 ID 为 `default`、名称为“原有账户”；新增账户由服务器分配 ID，名称为 1–20 个字符，同一家庭内不能重名。
- 创建时复制当前账户已保存的字库、拼音、组词和设置；所有字重置为 `LEARNING`，学习计数及历史清空，不继承今日队列或周末清单。后续编辑、答题、设置和清空重学仅作用于当前账户。
- 只在首页提供添加和切换入口，其他页面显示当前账户名称。存在未同步进度时禁用添加和切换；网络恢复并完成同步后再继续。新增请求结果不明时先刷新目录，让用户确认是否已创建，不能盲目重复创建。
- 同步控制器在创建时绑定账户 ID。切换账户时销毁旧控制器，旧请求迟到不得改状态、缓存或冲突快照；尚未完成的快照应保留在该账户的本地缓存。服务端响应中的账户 ID 必须匹配，原有账户可兼容旧响应缺少 ID 的格式。
- `accountStorage` 让原有账户保留旧缓存键；新增账户使用 `kids-literacy:account:${encodeURIComponent(accountId)}:` 前缀包装进度、同步元数据与冲突快照的全部键。不能把原有账户的缓存迁移到新账户。
- 原有账户沿用 `/api/progress`；新增账户读写 `/api/account-progress?accountId=<账户ID>`，各自使用独立版本号。`/api/accounts` 负责读取目录和创建，所有接口仍校验家庭会话与账户归属；旧进度接口拒绝非默认账户参数。独立路由可避免程序回滚后把新增账户写进原有账户。
- SQLite 只新增 `learning_accounts` 表，保留原 `progress` 与 `device_sessions` 表及数据；`default` 仍落在原表。旧设备 `/api/progress/migrate` 只允许迁移原有账户，新账户不存在时不能自动迁移或复制旧缓存。

## 发布与数据边界

正式站点为 `https://z.allon.me`，运行 Node.js API 和 SQLite，不能改成 GitHub Pages 纯静态部署。当前 Node 服务监听 `127.0.0.1:17303`，nginx 提供 HTTPS。

原有账户的浏览器缓存键为 `kids-literacy:v1`，新增账户使用上述命名空间，SQLite 是权威永久存储。保留家庭码登录、原设备迁移保护、离线补传和各账户的版本冲突保护；不能用旧本地实现替换这些模块。家庭码只保留哈希，不能将明文写入文档、仓库或日志。

发布前运行现有备份服务并确认新备份生成。数据库固定在 `/var/lib/kids-literacy/progress.sqlite`，备份位于 `/var/backups/kids-literacy/`；发布和回滚只切换 `/opt/kids-literacy-garden` 程序版本，不替换数据库或备份目录。恢复顺序及权限要求按 README 的“备份与恢复”执行。

只修改本次需求相关文件，保持已有风格；行为、命令或配置变化时同步维护 README 与本文件。
