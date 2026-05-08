---
id: TASK-HENGYI-DICTATION-20260508-174923-t4-tdd
title: T4: 激励话术系统（TDD）
status: done
source: manual
created_at: 2026-05-08T17:49:23+0800
updated_at: 2026-05-08T18:28:41+0800
working_directory: /Users/vvc/.openclaw/workspace/projects/hengyi-dictation
---

## Goal
T4: 激励话术系统（TDD）

## Context
## Task Type
lightweight

## Target File
js/app.js（finishDictationGrading 中的 summaryHtml）

## Exact Outcome
根据当日正确率在结果页显示激励话术。话术档位：
- 100% → "太棒了，全对！💪"
- ≥80% → "不错，继续加油！👍"
- ≥60% → "还有进步空间，下次会更好！📈"
- <60% → "别灰心，多练几次就熟了！🔥"

## Acceptance Criteria
- 100% 正确率显示全对话术
- 80-99% 显示鼓励话术
- 60-79% 显示进步话术
- <60% 显示安慰话术
- 话术显示在正确率下方

## Validation
- 浏览器模拟不同正确率场景，检查话术匹配

## Out Of Scope
- 不修改数据记录逻辑
- 不修改统计页（T5/T6/T7 负责）

## Blocked By
- TASK-HENGYI-DICTATION-20260508-174904-t2-app-js-daily-stats-tdd

## Parallelizable With
- T3 accuracy display

## Conflict Surface
- js/app.js

## Acceptance Criteria
- Define concrete acceptance checks before execution.
- Leave clear evidence of completion in task output or related docs.

## Notes
- Created by project_task.sh create.

## Completion Summary
激励话术完成，四档正确率对应不同鼓励语
