# 数据到UI的映射层设计（Data-to-UI Mapping Layer）

## 1. 问题定义

用户的核心关切：
> "拿到原始数据后，怎么映射到最终的展示，结合用户的自然语言指令，skill memory，分析出用户需要页面长什么样"

这不是简单的数据渲染问题，而是**"意图理解 + 数据理解 + 视觉决策"**的复合问题。

## 2. 映射层架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    Data-to-UI Mapping Layer                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐   │
│  │ 意图理解层   │  │ 数据理解层   │  │      视觉决策层          │   │
│  │ (Intent)    │  │ (Data)      │  │     (Visual)            │   │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬────────────┘   │
│         │                │                    │                │
│         ▼                ▼                    ▼                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              融合决策引擎 (Fusion Engine)                  │   │
│  │     结合意图 + 数据 + Skill Memory → UI决策               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              UI Protocol 生成器                            │   │
│  │     输出标准化的UIRenderProtocol                          │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 3. 三层映射模型

### 3.1 意图理解层（Intent Understanding）

**输入**：用户自然语言指令
**输出**：结构化的意图描述

```typescript
interface UserIntent {
  // 用户想要什么
  goal: 'explore' | 'compare' | 'trend' | 'distribution' | 'relationship' | 'summary';
  
  // 关注的数据维度
  dimensions: string[];
  
  // 关注的指标
  metrics: string[];
  
  // 时间范围（如果有）
  timeRange?: { start: string; end: string };
  
  // 排序/过滤偏好
  preferences: {
    sortBy?: string;
    filter?: Record<string, unknown>;
    topN?: number;
  };
  
  // 视觉偏好（从对话历史推断）
  visualPreference?: 'chart' | 'table' | 'card' | 'mixed';
}
```

**实现方式**：
- 使用LLM进行意图分类（轻量级，可在前端完成）
- 维护意图分类的示例库（prompt engineering）
- 结合对话上下文进行意图消歧

### 3.2 数据理解层（Data Understanding）

**输入**：原始数据（JSON/CSV/表格）
**输出**：数据特征描述 + 推荐的可视化类型

```typescript
interface DataProfile {
  // 数据概览
  overview: {
    rowCount: number;
    columnCount: number;
    hasTimeSeries: boolean;
    hasGeographic: boolean;
  };
  
  // 字段分析
  fields: DataField[];
  
  // 统计特征
  statistics: {
    cardinality: Record<string, number>;
    distributions: Record<string, Distribution>;
    correlations: CorrelationMatrix;
  };
  
  // 数据质量
  quality: {
    missingRate: Record<string, number>;
    outlierCount: number;
  };
}

interface DataField {
  name: string;
  type: 'categorical' | 'numerical' | 'temporal' | 'geographical' | 'textual';
  subtype: 'integer' | 'float' | 'string' | 'date' | 'boolean';
  
  // 统计特征
  stats: {
    min?: number;
    max?: number;
    mean?: number;
    median?: number;
    uniqueCount: number;
    nullCount: number;
  };
  
  // 推荐的展示方式
  suggestedRoles: ('x' | 'y' | 'color' | 'size' | 'shape' | 'tooltip' | 'filter')[];
}
```

**自动分析逻辑**：

```typescript
function analyzeData(data: unknown[]): DataProfile {
  const profile: DataProfile = { ... };
  
  // 1. 推断字段类型
  for (const field of fields) {
    if (isTemporal(field)) {
      field.type = 'temporal';
      field.suggestedRoles = ['x', 'color', 'filter'];
    } else if (isNumerical(field)) {
      field.type = 'numerical';
      field.suggestedRoles = ['y', 'size', 'color'];
    } else if (isCategorical(field)) {
      field.type = 'categorical';
      field.suggestedRoles = ['x', 'color', 'shape', 'filter'];
    }
  }
  
  // 2. 检测数据模式
  if (hasTimeSeries(data)) {
    profile.overview.hasTimeSeries = true;
  }
  
  // 3. 计算相关性
  profile.statistics.correlations = computeCorrelations(data);
  
  return profile;
}
```

### 3.3 视觉决策层（Visual Decision）

**输入**：意图 + 数据特征 + Skill Memory
**输出**：推荐的视觉编码方案

```typescript
interface VisualDecision {
  // 推荐的图表类型
  chartType: ChartType;
  
  // 视觉编码映射
  encoding: VisualEncoding;
  
  // 布局建议
  layout: LayoutSuggestion;
  
  // 交互建议
  interactions: InteractionSuggestion[];
  
  // 置信度
  confidence: number;
  
  // 决策理由（用于解释）
  reasoning: string;
}

interface VisualEncoding {
  // 字段到视觉通道的映射
  x?: string;           // X轴字段
  y?: string;           // Y轴字段
  color?: string;       // 颜色字段
  size?: string;        // 大小字段
  shape?: string;       // 形状字段
  tooltip?: string[];   // 提示字段
}
```

**决策规则引擎**：

```typescript
// 基于数据特征和意图的图表推荐规则
const chartRecommendationRules: ChartRecommendationRule[] = [
  {
    // 时间序列趋势 → 折线图
    condition: (intent, data) => 
      intent.goal === 'trend' && 
      data.overview.hasTimeSeries,
    chartType: 'line',
    reasoning: '时间序列数据适合用折线图展示趋势变化'
  },
  {
    // 分类对比 → 柱状图
    condition: (intent, data) => 
      intent.goal === 'compare' && 
      data.fields.some(f => f.type === 'categorical'),
    chartType: 'bar',
    reasoning: '分类数据对比适合用柱状图'
  },
  {
    // 分布分析 → 直方图/箱线图
    condition: (intent, data) => 
      intent.goal === 'distribution',
    chartType: 'histogram',
    reasoning: '展示数据分布情况'
  },
  {
    // 相关性分析 → 散点图/热力图
    condition: (intent, data) => 
      intent.goal === 'relationship',
    chartType: 'scatter',
    reasoning: '展示变量间的关系'
  },
  {
    // 占比分析 → 饼图/环形图
    condition: (intent, data) => 
      intent.goal === 'proportion',
    chartType: 'pie',
    reasoning: '展示部分与整体的关系'
  }
];
```

## 4. Skill Memory 的整合

### 4.1 Skill Memory 结构

```typescript
interface SkillMemory {
  // 用户偏好记忆
  userPreferences: UserPreferenceMemory;
  
  // 领域知识记忆
  domainKnowledge: DomainKnowledgeMemory;
  
  // 历史决策记忆
  decisionHistory: DecisionHistoryMemory;
}

interface UserPreferenceMemory {
  // 用户偏好的图表类型
  preferredChartTypes: Record<string, number>; // chartType -> frequency
  
  // 用户偏好的颜色主题
  preferredColorScheme: string;
  
  // 用户常用的数据维度
  frequentlyUsedDimensions: string[];
  
  // 用户对特定数据集的偏好
  datasetPreferences: Record<string, DatasetPreference>;
}

interface DomainKnowledgeMemory {
  // 业务术语映射
  businessTerms: Record<string, BusinessTerm>;
  
  // 指标定义
  metricDefinitions: Record<string, MetricDefinition>;
  
  // 数据关系
  dataRelationships: DataRelationship[];
}

interface DecisionHistoryMemory {
  // 历史决策记录
  decisions: HistoricalDecision[];
  
  // 用户反馈
  feedback: UserFeedback[];
}
```

### 4.2 Skill Memory 的获取与使用

```typescript
// 从现有Skill系统获取Memory
async function getSkillMemory(agentId: string): Promise<SkillMemory> {
  // 1. 从Gateway获取Agent的Memory
  const memory = await invokeApi('agent.getMemory', { agentId });
  
  // 2. 解析Memory内容
  return parseSkillMemory(memory);
}

// 在视觉决策中应用Skill Memory
function applySkillMemory(
  decision: VisualDecision,
  memory: SkillMemory,
  intent: UserIntent
): VisualDecision {
  const enhanced = { ...decision };
  
  // 1. 应用用户偏好
  if (memory.userPreferences.preferredChartTypes[intent.goal]) {
    enhanced.chartType = memory.userPreferences.preferredChartTypes[intent.goal];
  }
  
  // 2. 应用领域知识
  for (const dimension of intent.dimensions) {
    const term = memory.domainKnowledge.businessTerms[dimension];
    if (term) {
      // 使用业务术语的推荐展示方式
      enhanced.encoding = { ...enhanced.encoding, ...term.suggestedEncoding };
    }
  }
  
  // 3. 应用历史决策
  const similarDecision = findSimilarDecision(memory.decisionHistory, intent);
  if (similarDecision && similarDecision.userSatisfaction > 0.8) {
    enhanced.layout = similarDecision.layout;
  }
  
  return enhanced;
}
```

## 5. 融合决策引擎（Fusion Engine）

### 5.1 决策流程

```
┌─────────────────────────────────────────────────────────────┐
│                    Fusion Engine                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  输入                                                        │
│   ├── 用户意图 (Intent)                                       │
│   ├── 数据特征 (Data Profile)                                │
│   ├── Skill Memory                                           │
│   └── 对话上下文 (Context)                                    │
│                                                             │
│  步骤1: 意图-数据匹配                                         │
│   ├── 验证意图中的维度是否存在于数据中                         │
│   ├── 推断缺失的维度                                          │
│   └── 生成候选字段组合                                         │
│                                                             │
│  步骤2: 视觉编码生成                                          │
│   ├── 应用推荐规则 → 候选图表类型                              │
│   ├── 应用Skill Memory → 调整偏好                              │
│   └── 生成视觉编码方案                                         │
│                                                             │
│  步骤3: 布局生成                                              │
│   ├── 确定主视觉元素                                          │
│   ├── 添加辅助元素（标题、图例、筛选器）                        │
│   └── 生成布局描述                                            │
│                                                             │
│  步骤4: 置信度评估                                            │
│   ├── 检查数据-视觉映射的合理性                                │
│   ├── 评估与用户意图的匹配度                                    │
│   └── 生成置信度分数                                          │
│                                                             │
│  输出: UI Protocol                                            │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 核心算法

```typescript
class FusionEngine {
  private rules: ChartRecommendationRule[];
  private memory: SkillMemory;
  
  constructor(rules: ChartRecommendationRule[], memory: SkillMemory) {
    this.rules = rules;
    this.memory = memory;
  }
  
  async generateUIProtocol(
    intent: UserIntent,
    data: unknown[],
    context: ConversationContext
  ): Promise<UIRenderProtocol> {
    
    // 1. 数据理解
    const dataProfile = analyzeData(data);
    
    // 2. 意图-数据匹配
    const matchedIntent = this.matchIntentToData(intent, dataProfile);
    
    // 3. 视觉决策
    const visualDecision = this.makeVisualDecision(matchedIntent, dataProfile);
    
    // 4. 应用Skill Memory
    const enhancedDecision = applySkillMemory(visualDecision, this.memory, matchedIntent);
    
    // 5. 生成UI Protocol
    const protocol = this.buildUIProtocol(enhancedDecision, dataProfile);
    
    // 6. 置信度评估
    protocol.confidence = this.evaluateConfidence(protocol, matchedIntent, dataProfile);
    
    return protocol;
  }
  
  private makeVisualDecision(
    intent: UserIntent,
    dataProfile: DataProfile
  ): VisualDecision {
    // 应用规则引擎
    const candidates = this.rules
      .filter(rule => rule.condition(intent, dataProfile))
      .map(rule => ({
        chartType: rule.chartType,
        reasoning: rule.reasoning,
        score: this.scoreRule(rule, intent, dataProfile)
      }));
    
    // 选择最高分的方案
    const best = candidates.sort((a, b) => b.score - a.score)[0];
    
    return {
      chartType: best.chartType,
      encoding: this.generateEncoding(best.chartType, intent, dataProfile),
      layout: this.generateLayout(best.chartType, dataProfile),
      interactions: this.generateInteractions(best.chartType, intent),
      confidence: best.score,
      reasoning: best.reasoning
    };
  }
  
  private generateEncoding(
    chartType: ChartType,
    intent: UserIntent,
    dataProfile: DataProfile
  ): VisualEncoding {
    const encoding: VisualEncoding = {};
    
    // 根据图表类型和数据特征自动映射字段
    switch (chartType) {
      case 'line':
      case 'bar':
        // X轴：时间或分类字段
        encoding.x = this.findBestXField(dataProfile, intent);
        // Y轴：数值字段
        encoding.y = this.findBestYField(dataProfile, intent);
        break;
        
      case 'scatter':
        encoding.x = this.findNumericalField(dataProfile);
        encoding.y = this.findNumericalField(dataProfile, [encoding.x]);
        encoding.color = this.findCategoricalField(dataProfile);
        break;
        
      case 'pie':
        encoding.color = this.findCategoricalField(dataProfile);
        encoding.size = this.findNumericalField(dataProfile);
        break;
    }
    
    return encoding;
  }
  
  private buildUIProtocol(
    decision: VisualDecision,
    dataProfile: DataProfile
  ): UIRenderProtocol {
    // 构建UI Protocol
    return {
      version: '1.0',
      canvas: this.generateCanvasConfig(decision, dataProfile),
      components: this.generateComponents(decision, dataProfile),
      dataBindings: this.generateDataBindings(dataProfile),
      interactions: this.generateInteractions(decision)
    };
  }
}
```

## 6. 与现有系统的集成

### 6.1 在RenderAgent中的位置

```
┌─────────────────────────────────────────────────────────────┐
│                      RenderAgent                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Data-to-UI Mapping Layer                  │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │   │
│  │  │ 意图理解  │  │ 数据理解  │  │    视觉决策       │  │   │
│  │  └────┬─────┘  └────┬─────┘  └────────┬─────────┘  │   │
│  │       └─────────────┴──────────────────┘              │   │
│  │                      │                              │   │
│  │                      ▼                              │   │
│  │              ┌──────────────┐                      │   │
│  │              │ 融合决策引擎  │                      │   │
│  │              └──────┬───────┘                      │   │
│  │                     │                              │   │
│  │                     ▼                              │   │
│  │              ┌──────────────┐                      │   │
│  │              │ UI Protocol  │                      │   │
│  │              └──────────────┘                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  输入: 自然语言指令 + 原始数据 + Skill Memory               │
│  输出: UIRenderProtocol                                     │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 与Gateway的交互

```typescript
// RenderAgent的核心流程
class RenderAgent {
  private fusionEngine: FusionEngine;
  private skillMemory: SkillMemory;
  
  async handleUserRequest(request: UserRequest): Promise<UIRenderProtocol> {
    // 1. 解析用户意图
    const intent = await this.parseIntent(request.text);
    
    // 2. 获取数据（通过Tool调用CLI）
    const data = await this.queryData(intent);
    
    // 3. 获取Skill Memory
    const memory = await this.getSkillMemory();
    
    // 4. 使用Fusion Engine生成UI Protocol
    const protocol = await this.fusionEngine.generateUIProtocol(
      intent,
      data,
      request.context,
      memory
    );
    
    // 5. 返回结果
    return protocol;
  }
  
  private async parseIntent(text: string): Promise<UserIntent> {
    // 使用LLM进行意图解析
    const prompt = `
分析用户的可视化需求，提取以下信息：
- 目标：探索/对比/趋势/分布/关系/汇总
- 数据维度：
- 指标：
- 时间范围：
- 偏好：

用户指令：${text}
`;
    
    return await this.llm.complete(prompt);
  }
  
  private async queryData(intent: UserIntent): Promise<unknown[]> {
    // 调用Tool获取数据
    return await this.tools.queryBusinessData({
      dimensions: intent.dimensions,
      metrics: intent.metrics,
      timeRange: intent.timeRange
    });
  }
}
```

## 7. 迭代优化机制

### 7.1 用户反馈循环

```
用户反馈
   │
   ▼
┌─────────────────┐
│  反馈收集器     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  决策评估器     │ ← 对比用户反馈与当前决策
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Skill Memory   │ ← 更新Memory
│  更新器        │
└─────────────────┘
```

### 7.2 反馈类型

```typescript
interface UserFeedback {
  // 反馈类型
  type: 'explicit' | 'implicit';
  
  // 显式反馈
  explicitFeedback?: {
    rating: number; // 1-5星
    comment: string;
    preferredChartType?: string;
  };
  
  // 隐式反馈
  implicitFeedback?: {
    // 用户是否修改了图表类型
    changedChartType: boolean;
    // 用户是否调整了布局
    adjustedLayout: boolean;
    // 停留时间
    dwellTime: number;
    // 是否导出
    exported: boolean;
  };
}
```

## 8. 关键设计决策

### 8.1 为什么需要三层映射？

| 层级 | 职责 | 为什么需要 |
|------|------|----------|
| 意图理解 | 理解用户想要什么 | 自然语言是模糊的，需要结构化 |
| 数据理解 | 理解数据能做什么 | 数据特征决定了可行的可视化方式 |
| 视觉决策 | 决定最终长什么样 | 结合意图和数据，做出最佳视觉选择 |

### 8.2 Skill Memory的作用

1. **个性化**：记住用户偏好，提供个性化推荐
2. **领域知识**：理解业务术语，正确映射数据
3. **历史学习**：从过去决策中学习，持续优化

### 8.3 置信度机制

```typescript
interface ConfidenceScore {
  // 整体置信度
  overall: number;
  
  // 各维度置信度
  dimensions: {
    intentUnderstanding: number;  // 意图理解置信度
    dataQuality: number;            // 数据质量置信度
    visualAppropriateness: number;  // 视觉选择合适度
    skillMemoryMatch: number;       // Skill Memory匹配度
  };
  
  // 当置信度低时的建议
  suggestions: string[];
}
```

当置信度低于阈值时：
- 向用户展示多个候选方案
- 询问用户偏好
- 记录为反馈，用于优化

## 9. 实现建议

### 9.1 技术选型

| 组件 | 技术 | 理由 |
|------|------|------|
| 意图解析 | LLM (Claude/GPT) | 自然语言理解能力强 |
| 数据分析 | Web Worker + JS | 避免阻塞主线程 |
| 规则引擎 | 纯TypeScript | 轻量、可维护 |
| 视觉推荐 | 基于规则的系统 + LLM增强 | 可解释性强 |

### 9.2 性能考虑

1. **缓存策略**：
   - 数据Profile缓存（按数据源+时间范围）
   - 决策结果缓存（按意图+数据特征）
   - Skill Memory本地缓存

2. **异步处理**：
   - 数据分析在Web Worker中进行
   - UI Protocol生成可流式返回

3. **降级方案**：
   - 当LLM不可用时，使用纯规则引擎
   - 当数据量过大时，使用采样分析

## 10. 总结

Data-to-UI Mapping Layer 的核心价值：

1. **桥接数据和UI**：将原始数据转化为结构化的UI描述
2. **融合多源信息**：结合意图、数据、Skill Memory做出决策
3. **可解释性**：每个决策都有明确的理由
4. **可迭代优化**：通过用户反馈持续改进

这个层是生成式UI系统的"大脑"，决定了最终输出的质量和用户体验。
