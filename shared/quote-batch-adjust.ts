/**
 * VIP 批量参数调价 — NL → CLI `objectListJson` 结构（与 sai-cli schema 对齐）。
 * @see vip quotation-draft create / vip quotation-batch-check validate
 */

export type BatchAdjustWeightMark = '<' | '<=';

export type BatchAdjustType = 'ADD' | 'SUBTRACT' | 'MULTIPLY' | 'DIVIDE' | 'SET';

export type BatchAdjustSceneType = 'CUSTOMER' | 'SHOP' | 'MANAGER' | 'ZONE';

export interface BatchAdjustItem {
  areaDetail: string;
  startWeight: string;
  startWeightMark: BatchAdjustWeightMark;
  endWeight: string;
  endWeightMark: BatchAdjustWeightMark;
  adjustType: BatchAdjustType;
  adjustValue: string;
}

export interface BatchAdjustObject {
  objectName: string;
  sceneType: BatchAdjustSceneType | string;
  startDate: string;
  endDate: string;
  items: BatchAdjustItem[];
}

export interface BatchAdjustParams {
  /** 默认 `BASE_FREIGHT_FEE`（基础运费） */
  freightFeeType?: string;
  objectList: BatchAdjustObject[];
  /** 可选：给用户看的自然语言摘要 */
  summary?: string;
}

export interface BatchAdjustValidationResult {
  pass: boolean;
  warnings?: unknown[];
  preCheckErrors?: unknown[];
  validityErrors?: unknown[];
  flowWeightErrors?: unknown[];
  priceDetailErrors?: unknown[];
  ossUrl?: string;
  name?: string;
}

export interface BatchAdjustDraftResult {
  quotationList?: unknown[];
  quoteId?: string;
  freightQuotationList?: unknown[];
  surchargeQuotationList?: unknown[];
}

export interface BatchAdjustMissingField {
  path: string;
  label: string;
  hint: string;
}

const DEFAULT_FREIGHT_FEE_TYPE = 'BASE_FREIGHT_FEE';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseAdjustItem(raw: unknown): BatchAdjustItem | null {
  if (!isRecord(raw)) return null;
  const areaDetail = readString(raw.areaDetail);
  const startWeight = readString(raw.startWeight);
  const endWeight = readString(raw.endWeight);
  const adjustType = readString(raw.adjustType)?.toUpperCase() as BatchAdjustType | undefined;
  const adjustValue = readString(raw.adjustValue);
  const startWeightMark = raw.startWeightMark === '<' || raw.startWeightMark === '<=' ? raw.startWeightMark : null;
  const endWeightMark = raw.endWeightMark === '<' || raw.endWeightMark === '<=' ? raw.endWeightMark : null;
  if (!areaDetail || !startWeight || !endWeight || !adjustType || !adjustValue || !startWeightMark || !endWeightMark) {
    return null;
  }
  return {
    areaDetail,
    startWeight,
    startWeightMark,
    endWeight,
    endWeightMark,
    adjustType,
    adjustValue,
  };
}

function parseAdjustObject(raw: unknown): BatchAdjustObject | null {
  if (!isRecord(raw)) return null;
  const objectName = readString(raw.objectName);
  const sceneType = readString(raw.sceneType);
  const startDate = readString(raw.startDate);
  const endDate = readString(raw.endDate);
  if (!objectName || !sceneType || !startDate || !endDate) return null;
  if (!Array.isArray(raw.items) || raw.items.length === 0) return null;
  const items = raw.items.map(parseAdjustItem).filter((item): item is BatchAdjustItem => item != null);
  if (items.length === 0) return null;
  return { objectName, sceneType, startDate, endDate, items };
}

/** Parse `flow_card.data.batchAdjustParams` or raw object. */
export function parseBatchAdjustParams(raw: unknown): BatchAdjustParams | null {
  if (!isRecord(raw)) return null;
  const source = isRecord(raw.batchAdjustParams) ? raw.batchAdjustParams : raw;
  if (!isRecord(source)) return null;
  if (!Array.isArray(source.objectList) || source.objectList.length === 0) return null;
  const objectList = source.objectList.map(parseAdjustObject).filter((obj): obj is BatchAdjustObject => obj != null);
  if (objectList.length === 0) return null;
  const freightFeeType = readString(source.freightFeeType) ?? DEFAULT_FREIGHT_FEE_TYPE;
  const summary = readString(source.summary) ?? undefined;
  return { freightFeeType, objectList, summary };
}

export function parseBatchAdjustValidation(raw: unknown): BatchAdjustValidationResult | null {
  if (!isRecord(raw)) return null;
  const source = isRecord(raw.batchAdjustValidation) ? raw.batchAdjustValidation : raw;
  if (!isRecord(source)) return null;
  if (typeof source.pass !== 'boolean') return null;
  return {
    pass: source.pass,
    warnings: Array.isArray(source.warnings) ? source.warnings : undefined,
    preCheckErrors: Array.isArray(source.preCheckErrors) ? source.preCheckErrors : undefined,
    validityErrors: Array.isArray(source.validityErrors) ? source.validityErrors : undefined,
    flowWeightErrors: Array.isArray(source.flowWeightErrors) ? source.flowWeightErrors : undefined,
    priceDetailErrors: Array.isArray(source.priceDetailErrors) ? source.priceDetailErrors : undefined,
    ossUrl: readString(source.ossUrl) ?? undefined,
    name: readString(source.name) ?? undefined,
  };
}

export function parseBatchAdjustDraft(raw: unknown): BatchAdjustDraftResult | null {
  if (!isRecord(raw)) return null;
  const source = isRecord(raw.batchAdjustDraft) ? raw.batchAdjustDraft : raw;
  if (!isRecord(source)) return null;
  const hasList = Array.isArray(source.quotationList) && source.quotationList.length > 0;
  const quoteId = readString(source.quoteId);
  if (!hasList && !quoteId) return null;
  return {
    quotationList: Array.isArray(source.quotationList) ? source.quotationList : undefined,
    quoteId: quoteId ?? undefined,
    freightQuotationList: Array.isArray(source.freightQuotationList) ? source.freightQuotationList : undefined,
    surchargeQuotationList: Array.isArray(source.surchargeQuotationList) ? source.surchargeQuotationList : undefined,
  };
}

/** CLI `--objectListJson` 字符串（紧凑 JSON）。 */
export function serializeBatchAdjustObjectListJson(objectList: BatchAdjustObject[]): string {
  return JSON.stringify(objectList);
}

/** 列出缺参项，供 Skill 文本追问。 */
export function listMissingBatchAdjustFields(params: Partial<BatchAdjustParams> | null): BatchAdjustMissingField[] {
  const missing: BatchAdjustMissingField[] = [];
  if (!params?.objectList?.length) {
    missing.push({
      path: 'objectList',
      label: '调价对象',
      hint: '请说明要给哪些客户/对象调价，例如「李佳明」或「全部客户」。',
    });
    return missing;
  }

  params.objectList.forEach((obj, index) => {
    const prefix = `objectList[${index}]`;
    if (!obj.objectName?.trim()) {
      missing.push({
        path: `${prefix}.objectName`,
        label: '报价对象名称',
        hint: '请提供客户/对象名称，或说「全部客户」。',
      });
    }
    if (!obj.sceneType?.trim()) {
      missing.push({
        path: `${prefix}.sceneType`,
        label: '对象类型',
        hint: '请说明对象类型：客户、电子面单、业务员或承包区（默认客户）。',
      });
    }
    if (!obj.startDate?.trim()) {
      missing.push({
        path: `${prefix}.startDate`,
        label: '生效开始日期',
        hint: '请提供新报价生效开始日期，格式 yyyy-MM-dd。',
      });
    }
    if (!obj.endDate?.trim()) {
      missing.push({
        path: `${prefix}.endDate`,
        label: '生效结束日期',
        hint: '请提供新报价生效结束日期，格式 yyyy-MM-dd。',
      });
    }
    if (!obj.items?.length) {
      missing.push({
        path: `${prefix}.items`,
        label: '调价规则',
        hint: '请说明流向、重量段和调价幅度，例如「3公斤以上加0.2元/票」或「黑吉辽单票加0.2元」。',
      });
      return;
    }
    obj.items.forEach((item, itemIndex) => {
      const itemPath = `${prefix}.items[${itemIndex}]`;
      if (!item.areaDetail?.trim()) {
        missing.push({
          path: `${itemPath}.areaDetail`,
          label: '流向',
          hint: '请说明流向（省/市），或说「全部流向」。',
        });
      }
      if (!item.startWeight?.trim() || !item.endWeight?.trim()) {
        missing.push({
          path: `${itemPath}.weight`,
          label: '重量段',
          hint: '请说明重量段，例如「3公斤以上」「0-1kg」「首重1kg」。',
        });
      }
      if (!item.adjustType?.trim() || !item.adjustValue?.trim()) {
        missing.push({
          path: `${itemPath}.adjust`,
          label: '调价方式',
          hint: '请说明加/减/乘/除/设值及幅度，例如「上涨0.2元/票」「打九折」。',
        });
      }
    });
  });

  return missing;
}

export function isBatchAdjustFlowCardData(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  if (readString(data.scene) === 'batch_adjust') return true;
  return parseBatchAdjustParams(data) != null
    || parseBatchAdjustValidation(data) != null
    || parseBatchAdjustDraft(data) != null;
}
