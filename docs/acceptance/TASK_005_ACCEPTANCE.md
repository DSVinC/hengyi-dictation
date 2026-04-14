# Gemini 验收报告 - manualAddWordR1 修复

## 验收信息
- **验收 Agent**: Gemini CLI (acpx gemini exec)
- **验收时间**: 2026-04-14 21:12
- **修复 commit**: 002122e
- **原始 commit**: e2bc9e7（发现问题）

## 原始问题（Gemini 验收 e2bc9e7 发现）

### 问题 1：`manualAddWordR1` 二次存储
`manualSetRound` 先写入一次 localStorage + 弹窗，之后 `manualAddWordR1` 又对 `wrongCount + 1` 再写一次。

### 问题 2：输入框清空时序
`wordInput.value = ''` 在 `renderProgressPage()` 之后执行，但重绘已销毁旧 DOM 元素，清空无效。

## 修复方案

### 拆分 `updateWordProgress` 静默函数
```
updateWordProgress(subject, lessonId, text, round, wrongCountIncrement = 0)
```
- 只做数据写入，不弹窗、不重绘
- 支持 `wrongCountIncrement` 参数，一次性处理错词次数

### 修改三个函数
| 函数 | 修改 |
|------|------|
| `manualSetRound` | 改为调用 `updateWordProgress` + alert + 重绘 |
| `manualAddWordR1` | 调用 `updateWordProgress(..., 1, 1)` → 清空 → alert → 重绘 |
| `manualAddWordMastered` | 清空 → `updateWordProgress` → alert → 重绘 |

## 验收结果
- ✅ `node --check js/app.js` 语法通过
- ✅ 二次存储问题已修复（`manualAddWordR1` 只写一次）
- ✅ 输入框清空时序正确（重绘前执行）
- ✅ `manualSetRound` 独立调用仍正常（用户直接点击"设R1/重置"按钮）
