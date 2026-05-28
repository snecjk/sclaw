# Capability: `skills-plaza-detail`（本 change 新增）

## 新增需求

### Requirement: 技能详情弹窗

用户点击技能卡片（非快捷操作区域）MUST 打开详情弹窗。弹窗 MUST 展示技能的详细信息，包括标题、标签、统计数据、工作流介绍、流程步骤、调度与输出、数据概览以及"立即使用"CTA 按钮。

#### Scenario: 点击卡片打开详情弹窗
- **WHEN** 用户点击技能卡片的标题 / 描述 / 图标区域（排除"使用"、"安装"、"删除"、开关等快捷操作）
- **THEN** 系统 MUST 打开右侧滑出的详情弹窗
- **AND** 弹窗 MUST 包含标题、标签、统计数据行

#### Scenario: 工作流类技能展示全部 sections
- **WHEN** 详情弹窗打开且技能类型为工作流（`kind === 'workflow'`）
- **THEN** 弹窗 MUST 展示以下 sections：工作流介绍、流程步骤、调度与输出、数据概览
- **AND** 流程步骤 MUST 以有序编号列表渲染
- **AND** 调度与输出区块 MUST 以 label-value 卡片形式展示

#### Scenario: 普通技能展示基础信息
- **WHEN** 详情弹窗打开且技能类型非工作流
- **THEN** 弹窗 MUST 展示技能介绍
- **AND** 流程步骤、调度与输出 sections MUST NOT 展示（或展示默认描述）

### Requirement: 详情弹窗关闭

弹窗 MUST 可通过关闭按钮（×）、背景遮罩点击、或 Esc 键关闭。

#### Scenario: 点击关闭按钮
- **WHEN** 用户点击弹窗右上角的关闭按钮（×）
- **THEN** 弹窗 MUST 关闭
- **AND** 页面 MUST 恢复正常交互

#### Scenario: 点击背景遮罩
- **WHEN** 用户点击弹窗外的背景遮罩层
- **THEN** 弹窗 MUST 关闭

#### Scenario: 按 Esc 关闭
- **WHEN** 弹窗打开且用户按下 Esc 键
- **THEN** 弹窗 MUST 关闭

### Requirement: 详情弹窗"立即使用"CTA

弹窗底部 MUST 展示"立即使用"按钮。按钮行为 MUST 与卡片"使用"按钮一致（已安装则跳转对话，未安装则展示安装操作）。

#### Scenario: 已安装技能的立即使用
- **WHEN** 弹窗中的技能已在本地安装
- **THEN** "立即使用"按钮 MUST 可点击
- **AND** 点击后 MUST 跳转至对话页面并预填充技能的默认 prompt
- **AND** 弹窗 MUST 关闭

#### Scenario: 未安装技能的立即使用
- **WHEN** 弹窗中的技能未安装
- **THEN** "立即使用"按钮文字 MUST 变为"立即安装"
- **AND** 点击后 MUST 触发安装流程
- **AND** 安装完成后按钮文本 MUST 更新为"立即使用"

### Requirement: 详情弹窗数据来自后端 API

弹窗数据 MUST 由 `GET /api/skill-plaza/skill/:slug` 接口提供，包含 `intro`、`steps`、`schedule`、`output`、`overview` 等字段。

#### Scenario: 请求详情数据
- **WHEN** 用户打开详情弹窗
- **THEN** 系统 MUST 调用 `GET /api/skill-plaza/skill/:slug` 获取该技能的详情数据
- **AND** 若数据已在本地缓存则 MUST NOT 重复请求

### Requirement: 详情弹窗无障碍

弹窗 MUST 使用 `role="dialog"`、`aria-modal="true"`、`aria-labelledby`、`aria-describedby` 属性，确保屏幕阅读器可正确识别。

#### Scenario: 弹窗无障碍属性
- **WHEN** 详情弹窗打开
- **THEN** 弹窗容器 MUST 具有 `role="dialog"` 和 `aria-modal="true"`
- **AND** 标题元素 MUST 通过 `aria-labelledby` 关联
- **AND** 介绍元素 MUST 通过 `aria-describedby` 关联
