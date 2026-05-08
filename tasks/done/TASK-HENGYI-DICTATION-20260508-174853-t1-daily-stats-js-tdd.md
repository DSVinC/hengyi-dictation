---
id: TASK-HENGYI-DICTATION-20260508-174853-t1-daily-stats-js-tdd
title: T1: daily-stats.js 模块（TDD）— 每日正确率数据层
status: done
source: manual
created_at: 2026-05-08T17:48:53+0800
updated_at: 2026-05-08T18:16:51+0800
working_directory: /Users/vvc/.openclaw/workspace/projects/hengyi-dictation
---

## Goal
T1: daily-stats.js 模块（TDD）— 每日正确率数据层

## Context
## Task Type
strict-design

## Target File
js/daily-stats.js

## Exact Outcome
新建 daily-stats 模块，提供 record(subject, correct, total) 和 getAll() 接口。读写 data/daily-stats.json。数据格式：{"2026-05-08": {"chinese": {"correct": 17, "total": 20}, "english": {"correct": 15, "total": 20}}}。同一天同一科目多次听写自动累加 correct 和 total。

## Design References
- 现有存储模式参考：js/progress-store.js（使用 localStorage + JSON 文件）
- 数据格式决策：存储原始数字而非百分比，以便加权平均

## Design Excerpt
- daily-stats.json 路径：data/daily-stats.json
- record(subject, correct, total)：记录一次听写的正确/总数
- getAll()：返回完整数据对象
- 同日累加：若当天该科目已有记录，correct += newCorrect, total += newTotal
- 科目取值："chinese" | "english"
- 日期格式：YYYY-MM-DD（使用 getLocalDate() 而非 UTC）

## Task Interpretation
创建独立模块文件，不修改现有 progress-store.js。使用 localStorage 作为主要存储，data/daily-stats.json 作为同步目标。

## Acceptance Criteria
- record("chinese", 17, 20) 后 getAll() 返回当天语文数据
- 同日再 record("chinese", 3, 5) 后 correct=20, total=25
- 不同科目互不影响
- 跨天自动创建新记录
- 空数据时 getAll() 返回空对象 {}

## Validation
- 编写测试文件 tests/daily-stats.test.js，全部通过
- 浏览器控制台验证：导入模块后调用 record/getAll 输出正确

## Out Of Scope
- 不修改 app.js（T2 负责接入）
- 不处理 UI 展示
- 不处理 GitHub 同步（T8 负责）

## Blocked By
None - can start immediately

## Parallelizable With
- T0 progress-json sync protection
- T5 stats page nav
- T8 daily-stats sync

## Conflict Surface
- js/daily-stats.js
- data/daily-stats.json

## Acceptance Criteria
- Define concrete acceptance checks before execution.
- Leave clear evidence of completion in task output or related docs.

## Notes
- Created by project_task.sh create.

## Completion Summary
daily-stats.js 模块完成，12 项测试通过
