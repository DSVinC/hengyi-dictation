---
id: TASK-HENGYI-DICTATION-20260508-174904-t2-app-js-daily-stats-tdd
title: T2: app.js 接入 daily-stats 记录调用（TDD）
status: done
source: manual
created_at: 2026-05-08T17:49:04+0800
updated_at: 2026-05-08T18:19:15+0800
working_directory: /Users/vvc/.openclaw/workspace/projects/hengyi-dictation
---

## Goal
T2: app.js 接入 daily-stats 记录调用（TDD）

## Context
## Task Type
strict-design

## Target File
js/app.js（finishDictationGrading 函数）

## Exact Outcome
在 finishDictationGrading() 中，非重听模式（retryWordsMode=false）下，听写完成批改后调用 DailyStats.record(subject, correctCount, totalCount) 记录当日正确率数据。

## Design References
- daily-stats 模块：js/daily-stats.js（T1 产出）
- finishDictationGrading 函数已有 correctCount/wrongCount/totalWords 变量

## Design Excerpt
- 仅在非重听模式下记录（if (!isRetryMode)）
- subject 从 AppState.currentSubject 获取（"chinese" 或 "english"）
- correctCount 已在函数中计算
- totalCount = AppState.currentDictationList.length
- 在 saveProgress(wordUpdates) 之后调用 record

## Task Interpretation
在 finishDictationGrading 函数末尾、show summary 之前，插入 daily-stats 记录调用。需先 import DailyStats 模块。

## Acceptance Criteria
- 正常听写完成后，daily-stats.json 出现当天该科目记录
- 重听错词完成后，不产生新记录
- 多次正常听写，数据正确累加
- 控制台无 import 错误

## Validation
- 浏览器执行一次听写，检查 localStorage 中 daily-stats 数据
- 重听模式执行一次，确认无新增记录

## Out Of Scope
- 不修改结果页 UI（T3 负责）
- 不添加激励话术（T4 负责）

## Blocked By
- TASK-HENGYI-DICTATION-20260508-174853-t1-daily-stats-js-tdd

## Parallelizable With
None

## Conflict Surface
- js/app.js

## Acceptance Criteria
- Define concrete acceptance checks before execution.
- Leave clear evidence of completion in task output or related docs.

## Notes
- Created by project_task.sh create.

## Completion Summary
finishDictationGrading 已接入 DailyStats.record，非重听模式统计
