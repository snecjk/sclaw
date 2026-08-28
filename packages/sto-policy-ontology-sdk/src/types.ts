export type JsonObject = Record<string, unknown>;
export type JsonSchema = Record<string, unknown>;

export type PolicyAction =
  | 'discover'
  | 'executefunction'
  | 'resolvereference'
  | 'queryobjectset'
  | 'searcharound'
  | 'schema'
  | 'schemagraph'
  | 'describemetrictree'
  | 'help';

export type DiscoverRequest = {
  question: string;
};

export type ExecuteFunctionRequest = {
  functionRef: string;
  arguments: JsonObject;
};

export type ResolveReferenceRequest = {
  objectType: string;
  referenceText: string;
  page?: {
    limit?: number;
    cursor?: string;
    includeTotalCount?: boolean;
  };
};

export type PublicConstraintOp =
  | 'eq'
  | 'ne'
  | 'in'
  | 'not_in'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'contains'
  | 'is_null'
  | 'is_not_null';

export type PublicWhereItem = {
  key: string;
  op: PublicConstraintOp;
  value?: unknown;
};

export type PublicOrderByItem = {
  key: string;
  direction: 'asc' | 'desc';
};

export type PublicQueryTime = {
  dateDimension: string;
  latest?: true;
  at?: string;
  range?: {
    start: string;
    end?: string;
  };
};

export type PublicQueryScope =
  | { objectRef: string }
  | { objectType: string; within: string }
  | { objectType: string; all: true };

export type PublicCountMode = 'NONE' | 'INCLUDE' | 'ONLY';

export type QueryClauses = {
  time?: PublicQueryTime;
  select?: string[];
  where?: PublicWhereItem[];
  orderBy?: PublicOrderByItem[];
  limit?: number;
  cursor?: string;
  count?: PublicCountMode;
};

export type QueryObjectSetRequest = QueryClauses & {
  from: string;
  scope: PublicQueryScope;
};

export type SearchAroundRequest = QueryClauses & {
  from: string;
  relation: string;
};

export type SchemaRequest = {
  target: {
    kind: 'OBJECT_TYPE' | 'LINK_TYPE';
    key: string;
  };
  focus?: {
    metricKeys: string[];
  };
};

export type DescribeMetricTreeRequest = {
  query?: string;
  metricId?: string;
  metricKey?: string;
  metricKeys?: string[];
  entityType?: string;
  ownerType?: string;
  depth?: number;
  candidateLimit?: number;
  includeCandidates?: boolean;
};

export type HelpCommand =
  | 'discover'
  | 'execute-function'
  | 'resolve-reference'
  | 'resolve-references'
  | 'query-object-set'
  | 'search-around'
  | 'describe-metric-tree'
  | 'schema'
  | 'schema-graph'
  | 'help'
  | 'tools'
  | 'health'
  | 'version';

export type HelpRequest = {
  command?: HelpCommand;
  errorCode?: string;
  listErrors?: true;
};

export type PolicyRequestMap = {
  discover: DiscoverRequest;
  executefunction: ExecuteFunctionRequest;
  resolvereference: ResolveReferenceRequest;
  queryobjectset: QueryObjectSetRequest;
  searcharound: SearchAroundRequest;
  schema: SchemaRequest;
  schemagraph: undefined;
  describemetrictree: DescribeMetricTreeRequest;
  help: HelpRequest;
};

export type PolicyEndpoint =
  | {
      mode: 'direct';
      policyOrigin: string;
    }
  | {
      mode: 'same-origin-proxy';
      prefix: string;
    };

export type PolicyCallOptions = {
  signal?: AbortSignal;
};

export type PolicyFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type PolicySdkResult<T> = {
  data: T;
  traceId?: string;
  warnings: readonly unknown[];
};

export type PolicyOperation<
  A extends PolicyAction = PolicyAction,
  P extends Record<string, unknown> = Record<string, unknown>,
> = {
  operationId: string;
  action: A;
  parameterSchema: JsonSchema;
  buildBody(parameters: Readonly<P>): PolicyRequestMap[A];
};

export type StoPolicyOntologySdkOptions = {
  endpoint: PolicyEndpoint;
  tokenProvider: () => string | null | Promise<string | null>;
  operations?: readonly PolicyOperation[];
  timeoutMs?: number;
  fetch?: PolicyFetch;
};
