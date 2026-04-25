---
name: 恒一听写
description: 艾宾浩斯遗忘曲线驱动的智能听写排程系统
version: "1.0"

colors:
  primary: "#18a5ff"
  primary-hover: "#0070d9"
  primary-active: "#005bb5"
  accent: "#ff4d4f"
  accent-light: "#fff2f0"
  background: "#f5f5f5"
  surface: "#ffffff"
  surface-overlay: "#ffffff"
  text-primary: "#333333"
  text-secondary: "#666666"
  text-muted: "#999999"
  border: "#e8e8e8"
  border-focus: "#18a5ff"

typography:
  font-family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif"
  font-size-xs: "12px"
  font-size-sm: "14px"
  font-size-md: "16px"
  font-size-lg: "18px"
  font-size-xl: "20px"
  font-size-2xl: "24px"
  font-weight-normal: "400"
  font-weight-medium: "500"
  font-weight-bold: "600"

rounded:
  none: "0px"
  sm: "4px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  circle: "9999px"

spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
  section: "60px"

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "10px 16px"
    fontWeight: "{typography.font-weight-medium}"

  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"

  button-primary-active:
    backgroundColor: "{colors.primary-active}"

  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    border: "1px solid {colors.border}"
    rounded: "{rounded.md}"
    padding: "10px 16px"

  card:
    backgroundColor: "{colors.surface-overlay}"
    rounded: "{rounded.lg}"
    padding: "16px 20px"
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)"

  input:
    backgroundColor: "{colors.surface}"
    border: "1px solid {colors.border}"
    rounded: "{rounded.md}"
    padding: "10px 12px"

  input-focus:
    borderColor: "{colors.border-focus}"
    boxShadow: "0 0 0 2px rgba(24, 165, 255, 0.2)"

  badge-error:
    backgroundColor: "{colors.accent-light}"
    textColor: "{colors.accent}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"

  subject-button:
    backgroundColor: "{colors.surface}"
    border: "2px solid {colors.border}"
    rounded: "{rounded.lg}"
    padding: "24px"
    textColor: "{colors.text-primary}"

  lesson-item:
    backgroundColor: "{colors.surface}"
    borderBottom: "1px solid {colors.border}"
    padding: "12px 16px"
---
## 概述

恒一听写是一款基于艾宾浩斯遗忘曲线理论的智能听写排程系统，专为小学生学习语文和英语词汇设计。UI 风格简洁现代，强调易用性和清晰的信息层级。

## 设计原则

1. **简洁清晰**：去除不必要的视觉元素，专注内容
2. **操作直观**：按钮和交互符合用户预期
3. **反馈及时**：操作结果即时反馈（成功/错误状态）
4. **移动优先**：针对手机端触摸交互优化

## 颜色系统

- **主色 (#18a5ff)**: 品牌蓝，用于主要按钮、链接、交互元素
- **强调色 (#ff4d4f)**: 警示红，用于错误提示、错词标记
- **背景 (#f5f5f5)**: 浅灰底，营造舒适的阅读氛围
- **卡片 (#ffffff)**: 白色卡片承载内容

## 字体

系统字体栈，优先使用设备原生字体：
```
-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 
'PingFang SC', 'Microsoft YaHei', sans-serif
```

字号层级：12px（标签）、14px（次要）、16px（正文）、18-20px（章节标题）、24px（页面标题）

## 圆角

- 4px: 标签、徽章
- 8px: 按钮、输入框
- 12px: 卡片、列表项
- 9999px: 圆形元素

## 间距

基础单位 4px，8px 递增：4px / 8px / 12px / 16px / 20px / 24px / 60px

## 注意事项

- 错词标记使用复选框，勾选表示"写错"
- 进度统计按掌握程度分级（R1-R6）
- 复习列表按下次复习时间排序
- 单词显示顺序：生词 > 错词 > 复习词