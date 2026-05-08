---
id: TASK-HENGYI-DICTATION-20260508-174937-t5
title: T5: 统计页导航 + 骨架
status: done
source: manual
created_at: 2026-05-08T17:49:37+0800
updated_at: 2026-05-08T18:16:51+0800
working_directory: /Users/vvc/.openclaw/workspace/projects/hengyi-dictation
---

## Goal
T5: 统计页导航 + 骨架

## Context
## Task Type
lightweight

## Target File
index.html（导航入口）+ js/app.js（renderStatsPage 函数）

## Exact Outcome
在首页导航增加第4个入口"📊 统计"；新增 renderStatsPage() 函数，无数据时显示"暂无数据，完成第一次听写后这里会出现你的学习趋势 📈"。

## Acceptance Criteria
- 首页导航出现"📊 统计"入口
- 点击可进入统计页
- 无数据时显示友好空状态
- 页面风格与现有页面一致

## Validation
- 浏览器点击导航，确认统计页可访问

## Out Of Scope
- 不画折线图（T6 负责）
- 不显示数据表格（T7 负责）

## Blocked By
None - can start immediately

## Parallelizable With
- T0 progress-json sync protection
- T1 daily-stats module
- T8 daily-stats sync

## Conflict Surface
- index.html
- js/app.js

## Acceptance Criteria
- Define concrete acceptance checks before execution.
- Leave clear evidence of completion in task output or related docs.

## Notes
- Created by project_task.sh create.

## Completion Summary
统计页导航和骨架完成
