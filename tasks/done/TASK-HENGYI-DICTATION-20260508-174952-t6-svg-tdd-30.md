---
id: TASK-HENGYI-DICTATION-20260508-174952-t6-svg-tdd-30
title: T6: SVG 折线图（TDD）— 近30天正确率趋势
status: done
source: manual
created_at: 2026-05-08T17:49:52+0800
updated_at: 2026-05-08T18:22:24+0800
working_directory: /Users/vvc/.openclaw/workspace/projects/hengyi-dictation
---

## Goal
T6: SVG 折线图（TDD）— 近30天正确率趋势

## Context
## Task Type
strict-design

## Target File
js/app.js

## Exact Outcome
在统计页渲染 SVG 手绘折线图，双线图（语文/英语），近 30 天数据，带坐标轴、刻度、图例。零依赖，纯 SVG。

## Design References
- 数据源：DailyStats.getAll()
- 坐标系：SVG viewBox 动态计算，横轴日期，纵轴正确率 0-100%
- 颜色：语文用蓝色 #3b82f6，英语用绿色 #10b981

## Design Excerpt
- 取近 30 天数据，按日期排序
- 每天两个数据点（语文正确率、英语正确率）
- 无数据的日期跳过
- 坐标轴：横轴日期标签（MM/DD），纵轴 0/25/50/75/100% 刻度
- 图例：右上角，蓝=语文，绿=英语
- 数据点用小圆点标注
- 空数据时显示空状态（T5 已处理）

## Task Interpretation
在 renderStatsPage 函数中增加 SVG 生成逻辑，用 innerHTML 或 DOM API 插入 SVG 元素。手绘折线，不引入任何图表库。

## Acceptance Criteria
- 有数据时显示 SVG 折线图
- 两条线颜色不同，有图例
- 坐标轴清晰，刻度正确
- 仅一条线有数据时只显示一条线
- 数据点 < 2 时不画折线（只显示点）

## Validation
- 造 30 天 mock 数据，浏览器渲染检查 SVG
- 仅语文数据时只显示蓝线
- 空数据时显示空状态

## Out Of Scope
- 不处理数据表格（T7 负责）
- 不处理数据记录（T1/T2 已负责）

## Blocked By
- TASK-HENGYI-DICTATION-20260508-174853-t1-daily-stats-js-tdd
- TASK-HENGYI-DICTATION-20260508-174937-t5

## Parallelizable With
- T3 accuracy display
- T4 encouragement messages
- T7 data table

## Conflict Surface
- js/app.js

## Acceptance Criteria
- Define concrete acceptance checks before execution.
- Leave clear evidence of completion in task output or related docs.

## Notes
- Created by project_task.sh create.

## Completion Summary
SVG 折线图完成，双线/图例/坐标轴
