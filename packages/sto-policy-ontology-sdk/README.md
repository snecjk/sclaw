# @sto/policy-ontology-sdk

STO Policy Ontology 九接口的类型安全客户端和 Operation Engine。

## 安装

```bash
npm install @sto/policy-ontology-sdk@0.1.0 --registry=http://snpm-registry.sto.cn
```

## 定义 Operation

具体 Operation 写在生成应用源码中，只声明业务参数、固定 Policy Action 和请求构造函数：

```ts
import { definePolicyOperation } from '@sto/policy-ontology-sdk';

export const siteList = definePolicyOperation({
  operationId: 'site.list',
  action: 'queryobjectset',
  parameterSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['limit'],
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
  },
  buildBody(parameters) {
    return {
      from: 'Site',
      scope: { objectType: 'Site', all: true },
      select: ['siteCode', 'siteName'],
      limit: Number(parameters.limit),
    };
  },
});
```

## 注册和调用

```ts
import { createStoPolicyOntologySdk } from '@sto/policy-ontology-sdk';
import { siteList } from './policy-operations';

const policy = createStoPolicyOntologySdk({
  endpoint: {
    mode: 'direct',
    policyOrigin: runtimeConfig.policyOrigin,
  },
  tokenProvider: getCurrentStoToken,
  operations: [siteList],
});

const result = await policy.execute('site.list', { limit: 20 });
```

发布直连时，Network URL 为：

```text
<policyOrigin>/sto-policy/api/v1/cli/ontology/<fixed-path>
```

本地代理模式下，Network URL 为：

```text
<prefix>/<action>
```

例如 `/__sto/policy/queryobjectset`。代理层负责映射到真实 Policy Path。

## 边界

- SDK只允许九个固定Policy Action，不接受任意Host、Method、Path或Header。
- Policy Origin和Token由调用方注入，Operation中不得出现URL或Token。
- 具体Operation随生成应用源码保存，不入库。
- SDK不包含SSO、Assets Bridge、Vite代理实现和应用启动逻辑。
