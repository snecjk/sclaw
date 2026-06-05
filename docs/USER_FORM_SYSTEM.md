# 用户表单系统 (User Form System)

## 测试

运行测试：
```bash
pnpm test tests/unit/user-form.test.tsx
```

测试覆盖率：
```bash
pnpm test -- --coverage
```

## 概述

用户表单系统允许 AI 代理在执行过程中动态地向用户请求确认或输入。当模型通过 skill、用户意图或执行链路需要用户确认或填写内容时，除了自然语言引导外，还可以弹出一个表单让用户选择或填写。

## 支持的表单类型

- **text** - 单行文本输入
- **textarea** - 多行文本输入
- **number** - 数字输入（支持最小值、最大值、步长、前缀、后缀）
- **select** - 下拉单选
- **multiselect** - 下拉多选
- **radio** - 单选按钮组
- **checkbox** - 复选框（单个布尔值或多个选项）
- **date** - 日期选择器
- **datetime** - 日期时间选择器
- **time** - 时间选择器
- **toggle** - 开关切换
- **hidden** - 隐藏字段

## 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                      Renderer Process                        │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │ UserFormModal│  │ useUserForm  │  │ form-api.ts         │ │
│  │ Component   │  │ Hook         │  │ (IPC Client)        │ │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬──────────┘ │
│         │                │                      │            │
│         └────────────────┴──────────────────────┘            │
│                          IPC                                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ form:show / form:response
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                       Main Process                           │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ form-handlers.ts (IPC Handlers)                         │ │
│  │ - form:show: Show form in renderer                      │ │
│  │ - form:response: Receive user response                  │ │
│  │ - form:isShowing: Check form status                     │ │
│  │ - form:hide: Hide current form                          │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## 文件结构

```
src/
├── types/
│   └── user-form.ts              # 表单类型定义
├── components/
│   └── user-form/
│       ├── UserFormModal.tsx     # 表单模态框组件
│       └── UserFormProvider.tsx  # 表单上下文提供者
├── hooks/
│   └── use-user-form.ts          # 表单 Hook
├── lib/
│   └── form-api.ts               # 表单 API 客户端
└── examples/
    └── user-form-example.tsx     # 使用示例

electron/
├── main/
│   └── ipc/
│       └── form-handlers.ts      # IPC 处理程序
└── types/
    └── user-form.ts              # 主进程类型定义（共享）
```

## 使用指南

### 1. 基本使用（通过 Hook）

```tsx
import { useUserForm } from '@/hooks/use-user-form';
import type { UserFormConfig } from '@/types/user-form';

function MyComponent() {
  const { config, isShowing, submitForm, cancelForm, FormModal } = useUserForm();

  return (
    <div>
      {/* Your component content */}
      {FormModal}
    </div>
  );
}
```

### 2. 显示表单（通过 API）

```tsx
import { showForm } from '@/lib/form-api';
import type { UserFormConfig } from '@/types/user-form';

async function handleUserInput() {
  const formConfig: UserFormConfig = {
    id: 'my-form-' + Date.now(),
    title: '确认信息',
    description: '请填写以下信息',
    fields: [
      {
        name: 'username',
        type: 'text',
        label: '用户名',
        placeholder: '请输入用户名',
        validation: {
          required: true,
          minLength: 3,
        },
      },
      {
        name: 'age',
        type: 'number',
        label: '年龄',
        min: 0,
        max: 150,
      },
      {
        name: 'role',
        type: 'select',
        label: '角色',
        options: [
          { value: 'admin', label: '管理员' },
          { value: 'user', label: '普通用户' },
        ],
      },
    ],
  };

  try {
    const response = await showForm(formConfig);
    if (!response.cancelled) {
      console.log('用户提交的值:', response.values);
    }
  } catch (error) {
    console.log('表单被取消或出错');
  }
}
```

### 3. 在 Skill 中使用

```typescript
// 在 Skill 执行过程中请求用户输入
async function executeSkillWithForm() {
  // ... skill logic ...
  
  // 需要用户确认
  const confirmForm: UserFormConfig = {
    id: 'skill-confirm',
    title: '确认操作',
    description: '此操作将执行以下动作...',
    fields: [
      {
        name: 'confirmed',
        type: 'toggle',
        label: '我已知晓并确认执行',
        defaultValue: false,
        validation: {
          custom: (value) => {
            if (!value) return '请确认后再继续';
            return null;
          },
        },
      },
    ],
  };

  const response = await showForm(confirmForm);
  if (response.cancelled || !response.values?.confirmed) {
    return { status: 'cancelled' };
  }

  // ... continue execution ...
}
```

### 4. 定时任务创建示例

```tsx
import { createScheduledTaskForm } from '@/examples/user-form-example';

async function createScheduledTaskWithForm() {
  const formConfig = createScheduledTaskForm({
    taskName: '每日晨报',
    taskDescription: '发送每日晨报到微信群',
    suggestedFrequency: 'daily',
    suggestedTime: '08:00',
  });

  const response = await showForm(formConfig);
  if (!response.cancelled) {
    // response.values contains:
    // - taskName
    // - taskDescription
    // - frequency
    // - time
    // - weekDays (if weekly)
    // - monthDay (if monthly)
    // - enabled
    // - notifyOnComplete
    
    await createScheduledTask(response.values);
  }
}
```

## 表单配置选项

### UserFormConfig

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| id | string | - | 表单唯一标识 |
| title | string | - | 模态框标题 |
| description | string | - | 模态框描述 |
| fields | FormField[] | - | 表单字段列表 |
| layout | FormLayout | - | 布局配置 |
| confirmLabel | string | "确认" | 确认按钮文本 |
| cancelLabel | string | "取消" | 取消按钮文本 |
| allowCancel | boolean | true | 是否允许取消 |
| closeOnCancel | boolean | true | 取消时关闭模态框 |
| closeOnConfirm | boolean | true | 确认时关闭模态框 |
| width | string \| number | "md" | 模态框宽度 |
| context | Record | - | 附加上下文数据 |

### 字段验证

每个字段可以配置验证规则：

```typescript
{
  name: 'email',
  type: 'text',
  label: '邮箱',
  validation: {
    required: true,
    minLength: 5,
    maxLength: 100,
    pattern: '^[\\w-\\.]+@([\\w-]+\\.)+[\\w-]{2,4}$',
    custom: (value) => {
      if (String(value).includes('test')) {
        return '不能使用测试邮箱';
      }
      return null;
    },
  },
}
```

## IPC 事件

### form:show (Renderer → Main)

请求显示表单

```typescript
ipcRenderer.invoke('form:show', {
  config: UserFormConfig,
  sessionId?: string,
  source?: 'skill' | 'intent' | 'workflow' | 'tool',
  sourceId?: string,
});
```

### form:response (Renderer → Main)

发送表单响应

```typescript
ipcRenderer.invoke('form:response', {
  formId: string,
  cancelled: boolean,
  values?: FormResult,
  timestamp: string,
});
```

### form:isShowing (Renderer → Main)

检查是否有表单正在显示

```typescript
const isShowing = await ipcRenderer.invoke('form:isShowing');
```

### form:hide (Renderer → Main)

隐藏当前表单

```typescript
await ipcRenderer.invoke('form:hide');
```

## 集成到应用

在应用根组件中添加 `UserFormProvider`：

```tsx
import { UserFormProvider } from '@/components/user-form/UserFormProvider';

function App() {
  return (
    <UserFormProvider>
      {/* Your app content */}
    </UserFormProvider>
  );
}
```

## 最佳实践

1. **唯一 ID**: 确保每个表单有唯一的 `id`，避免冲突
2. **验证规则**: 为重要字段添加验证规则，确保数据质量
3. **默认值**: 为字段提供合理的默认值，提升用户体验
4. **错误处理**: 始终处理表单取消和错误情况
5. **响应式设计**: 使用合适的模态框宽度适应不同内容
6. **字段分组**: 对于复杂表单，使用 `layout.columns` 进行字段分组

## 未来扩展

- [ ] 添加文件上传字段类型
- [ ] 添加富文本编辑器字段
- [ ] 支持表单字段动态显示/隐藏（基于其他字段值）
- [ ] 支持表单模板和复用
- [ ] 添加表单提交进度指示
- [ ] 支持多步骤表单（Wizard）
- [ ] 添加表单数据持久化（草稿保存）
