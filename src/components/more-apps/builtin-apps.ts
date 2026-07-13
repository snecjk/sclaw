/**
 * Builtin apps for 应用广场 — aligned with the PRD demo (more-apps.js)
 */
import type { AppItem } from '@/types/more-apps';

export const BUILTIN_APPS: AppItem[] = [
  {
    id: 'org-relation',
    name: '客户关系',
    description: '维护客户归属、店铺与电子面单等客户关系基础资料',
    url: 'https://wd-vip.sto.cn/claw-businessOrganization?useStoToken=1',
    iconKey: 'org-relation',
    iconUrl: '',
    tone: 'blue',
    category: '组织管理',
    kind: 'builtin',
    official: true,
    recommended: true,
    badge: '热门',
    recent: '今天 10:20',
    order: 0,
  },
  {
    id: 'customer-quote',
    name: '客户报价',
    description: '维护客户运费与加收费报价，支持首续重、均重、件量阶梯等计费模版',
    url: 'https://wd-vip.sto.cn/claw-quotationNew?useStoToken=1',
    iconKey: 'customer-quote',
    iconUrl: '',
    tone: 'orange',
    category: '经营管理',
    kind: 'builtin',
    official: true,
    recommended: true,
    recent: '今天 09:30',
    order: 1,
  },
  {
    id: 'customer-freight',
    name: '客户运费',
    description: '按运单查询与重算客户运费账单，支持单号计费与汇总账单查看',
    url: 'https://wd-vip.sto.cn/claw-billNew?useStoToken=1',
    iconKey: 'customer-freight',
    iconUrl: '',
    tone: 'orange',
    category: '经营管理',
    kind: 'builtin',
    official: true,
    recommended: true,
    badge: '推荐',
    recent: '今天 09:45',
    order: 2,
  },
  {
    id: 'cost-mgmt',
    name: '网点成本管理',
    description: '录入与分摊网点运营成本，追踪预算执行与成本趋势',
    url: 'https://wd-vip.sto.cn/claw-siteCostImport?useStoToken=1',
    iconKey: 'cost-mgmt',
    iconUrl: '',
    tone: 'green',
    category: '经营管理',
    kind: 'builtin',
    official: true,
    recommended: true,
    recent: '昨天 16:30',
    order: 3,
  },
  // {
  //   id: 'report-maker',
  //   name: '制表',
  //   description: '按经营模板快速制表，支持批量导出 Excel 报表',
  //   url: 'report-processing.html',
  //   iconKey: 'report-maker',
  //   iconUrl: '',
  //   tone: 'purple',
  //   category: '经营管理',
  //   kind: 'builtin',
  //   official: true,
  //   recommended: true,
  //   badge: '新品',
  //   recent: '昨天 14:10',
  //   order: 4,
  //   hidden: true,
  // },
  // {
  //   id: 'api-transfer',
  //   name: 'API 传输',
  //   description: '管理网点业务系统数据接口，统一接入供技能、工作流和 AI 分析使用',
  //   url: 'data-access.html',
  //   iconKey: 'api-transfer',
  //   iconUrl: '',
  //   tone: 'blue',
  //   category: '经营管理',
  //   kind: 'builtin',
  //   official: true,
  //   recommended: true,
  //   recent: '今天 11:00',
  //   order: 5,
  //   hidden: true,
  // },
];

/** Visible builtin apps (excludes hidden entries) */
export const VISIBLE_BUILTIN_APPS = BUILTIN_APPS.filter((a) => !a.hidden);

export interface MarketCategoryItem {
  id: string;
  label: string;
}

/** Derive market tab categories from visible builtin apps; first tab is 精选 (all apps). */
export function buildMarketCategories(apps: AppItem[]): MarketCategoryItem[] {
  const labels = [
    ...new Set(
      apps
        .filter((a) => !a.hidden && a.category)
        .map((a) => a.category as string),
    ),
  ];
  return [
    { id: 'featured', label: '精选' },
    ...labels.map((label) => ({ id: label, label })),
  ];
}

export const MARKET_CATEGORIES = buildMarketCategories(BUILTIN_APPS);

/** Hero carousel slides for the "应用广场" tab */
export const MARKET_HERO_SLIDES = [
  {
    appId: 'customer-freight',
    subtitle: '提升经营效率',
    theme: 'freight',
    stats: [
      { label: '客户关系', value: '自定义' },
      { label: '报价', value: '模版批量维护' },
      { label: '账单', value: '自动计费' },
    ],
  },
  {
    appId: 'org-relation',
    subtitle: '自定义客户与店铺关系绑定',
    theme: 'org',
    stats: [
      { label: '客户关系', value: '归属维护' },
      { label: '电子面单', value: '绑定管理' },
      { label: '业务员', value: '人员组织' },
    ],
  },
] as const;
