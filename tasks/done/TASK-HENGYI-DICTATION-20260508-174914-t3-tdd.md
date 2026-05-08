---
id: TASK-HENGYI-DICTATION-20260508-174914-t3-tdd
title: T3: 结果页显示正确率（TDD）
status: done
source: manual
created_at: 2026-05-08T17:49:14+0800
updated_at: 2026-05-08T18:25:51+0800
working_directory: /Users/vvc/.openclaw/workspace/projects/hengyi-dictation
---

## Goal
T3: 结果页显示正确率（TDD）

## Context
## Task Type
lightweight

## Target File
js/app.js（finishDictationGrading 中的 summaryHtml）

## Exact Outcome
在听写完成结果摘要中增加正确率显示，格式："📊 语文 85% (17/20)" 或 "📊 英语 75% (15/20)"。

## Acceptance Criteria
- 正常听写完成后，结果页显示正确率百分比
- 正确率计算：correct/total * 100，取整数
- 显示格式：emoji + 科目中文名 + 百分比 + (正确/总数)
- 重听模式不显示（或显示"重听不计入统计"）

## Validation
- 浏览器听写完成后检查结果页 HTML
- 正确率数字与实际 correct/total 一致

## Out Of Scope
- 不添加激励话术（T4 负责）
- 不修改数据记录逻辑（T2 已负责）

## Blocked By
- TASK-HENGYI-DICTATION-20260508-174904-t2-app-js-daily-stats-tdd

## Parallelizable With
- T4 encouragement messages

## Conflict Surface
- js/app.js

## Acceptance Criteria
- Define concrete acceptance checks before execution.
- Leave clear evidence of completion in task output or related docs.

## Notes
- Created by project_task.sh create.

## Completion Summary
结果页正确率显示完成，含颜色高亮
