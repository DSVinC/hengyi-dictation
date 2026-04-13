# TASK_001: 首页框架 + 听写模式页面

**状态**: development_complete
**开发者**: Claude Code
**启动时间**: 2026-04-13 19:31
**完成时间**: 2026-04-13 19:45
**预计完成**: 2026-04-13 20:00

## 交付物
1. ✅ `index.html` - 3 页导航 + 听写模式页面
2. ✅ `js/app.js` - 科目选择、课文/单元列表、词勾选逻辑
3. ✅ `css/style.css` - 移动端优先样式

## 测试数据
- `data/chinese/lessons.json` - 语文课目录（2课）
- `data/chinese/L01.json` - 第1课词语（6个）
- `data/chinese/L02.json` - 第2课词语（5个）
- `data/english/units.json` - 英语单元目录（2单元）
- `data/english/U01.json` - Unit 1 词语（5个）
- `data/english/U02.json` - Unit 2 词语（5个）

## 验收标准
- ✅ 打开网页能看到 3 页导航
- ✅ 听写模式页：选语文/英语 → 显示课/单元列表 → 点进去能勾选词语
- ✅ 数据从 `data/` 目录 JSON 文件读取（fetch）
- ✅ 勾选后生成听写清单（新课词 + 复习词）

## 测试方法
1. 启动本地服务器：`python3 -m http.server 8000` 或 `npx serve`
2. 打开浏览器访问 `http://localhost:8000`
3. 点击「语文」→ 选择「第1课」→ 勾选词语 → 点击「生成听写清单」
4. 点击「英语」→ 选择「Unit 1」→ 勾选词语 → 点击「生成听写清单」