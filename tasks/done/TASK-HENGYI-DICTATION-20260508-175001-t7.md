---
id: TASK-HENGYI-DICTATION-20260508-175001-t7
title: T7: 统计页数据表格
status: done
source: manual
created_at: 2026-05-08T17:50:01+0800
updated_at: 2026-05-08T18:24:48+0800
working_directory: /Users/vvc/.openclaw/workspace/projects/hengyi-dictation
---

## Goal
T7: 统计页数据表格

## Context
## Task Type
lightweight

## Target File
js/app.js

## Exact Outcome
在折线图下方显示每日数据表格，列：日期 | 语文正确率 | 英语正确率。按日期倒序排列。

## Acceptance Criteria
- 表格显示在折线图下方
- 每行显示日期 + 两科正确率（百分比）
- 某天只有一科数据时，另一科显示"-"
- 按日期倒序（最新在前）
- 样式与项目现有风格一致

## Validation
- 浏览器检查表格渲染

## Out Of Scope
- 不修改折线图（T6 负责）
- 不修改数据记录逻辑

## Blocked By
- TASK-HENGYI-DICTATION-20260508-174853-t1-daily-stats-js-tdd
- TASK-HENGYI-DICTATION-20260508-174937-t5

## Parallelizable With
- T3 accuracy display
- T4 encouragement messages
- T6 SVG chart

## Conflict Surface
- js/app.js

## Acceptance Criteria
- Define concrete acceptance checks before execution.
- Leave clear evidence of completion in task output or related docs.

## Notes
- Created by project_task.sh create.

## Completion Summary
统计页数据表格完成，含颜色高亮
