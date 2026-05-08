# Task: 掌握词池存储模块（TDD）

## 类型
dev

## 优先级
P1

## 依赖
无（可与 T0 并行，但在 T0 之后执行）

## 描述
创建 `js/mastered-pool.js` 模块，管理"掌握"类词池的每日随机复习记录。

### 功能需求
1. **MasteredPool 对象**：
   - `getTodayReviewed()` → 返回今天已随机到的掌握词文本 Set
   - `markReviewed(wordText)` → 标记一个词今天已随机到
   - `isDayReset()` → 检查是否跨天，需要重置
   - `resetIfNewDay()` → 跨天自动重置

2. **存储方案**：localStorage
   - key: `hengyi-mastered-reviewed`
   - 值格式: `{ date: "2026-05-08", words: ["词1", "词2", ...] }`

3. **自动重置逻辑**：
   - 每次调用时检查存储的 date 是否为今天
   - 如果不是今天，自动清空 words 数组并更新 date

### 修改文件
- 新建 `js/mastered-pool.js`
- `index.html` 添加 script 引用

### 验收标准
- 编写至少 5 个单元测试（可用内联测试）
- 跨天重置逻辑正确
- `node --check js/mastered-pool.js` 通过
