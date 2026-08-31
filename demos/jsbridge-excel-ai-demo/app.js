/**
 * Quote Excel → Claw Agent demo（仅 SClaw Bridge）
 * 依赖：@sto/claw-bridge-sdk@1.1.0
 * - 无 Bridge：提示「请在 SClaw 打开」
 * - Headless（推荐）：complete() → 结果回页面 → 应用修复 / 下载重新上传
 * - UI 联动：openDrawer + sendMessage（需粘贴 JSON）
 */
import {
  stoClaw,
  isStoClawBridgeAvailable,
  StoClawBridgeError,
} from '@sto/claw-bridge-sdk';

const COLS = ['客户编码', '客户名称', 'SKU', '产品名称', '单价', '折扣率', '生效日期', '备注'];

const SAMPLE_ROWS = [
  { 客户编码: 'C001', 客户名称: '华东物流', SKU: 'SKU-A01', 产品名称: '标准纸箱', 单价: '12.5', 折扣率: '0.9', 生效日期: '2026-09-01', 备注: '正常' },
  { 客户编码: 'C001', 客户名称: '华东物流', SKU: 'SKU-A02', 产品名称: '加固纸箱', 单价: '', 折扣率: '0.85', 生效日期: '2026-09-01', 备注: '缺单价' },
  { 客户编码: 'C002', 客户名称: '华北转运', SKU: 'SKU-B01', 产品名称: '泡沫填充', 单价: '-3', 折扣率: '0.1', 生效日期: '2026/09/01', 备注: '负单价+日期格式错' },
  { 客户编码: 'C003', 客户名称: '华南分拨', SKU: 'SKU-C01', 产品名称: '缠绕膜', 单价: '8.2', 折扣率: '1.5', 生效日期: '2026-09-01', 备注: '折扣超范围' },
  { 客户编码: 'C001', 客户名称: '华东物流', SKU: 'SKU-A01', 产品名称: '标准纸箱', 单价: '11.0', 折扣率: '0.88', 生效日期: '2026-09-15', 备注: '与第1行重复' },
  { 客户编码: 'C004', 客户名称: '', SKU: 'SKU-D01', 产品名称: '标签纸', 单价: '2.3', 折扣率: '0.95', 生效日期: '2026-09-01', 备注: '缺客户名称但可过' },
  { 客户编码: '', 客户名称: '西南网点', SKU: 'SKU-E01', 产品名称: '封箱胶', 单价: '1.8', 折扣率: '0.9', 生效日期: '2026-09-01', 备注: '缺客户编码' },
];

const state = {
  rows: [],
  errors: [],
  fieldErrors: {},
  patches: null,
  /** Headless 成功后 patches 已在内存，但尚未写入表格 */
  patchesPending: false,
  lastRequestId: null,
  bridgeAvailable: false,
  capabilities: [],
};

const el = {
  unsupported: document.getElementById('unsupported'),
  bootStatus: document.getElementById('bootStatus'),
  bootStatusText: document.getElementById('bootStatusText'),
  demoMain: document.getElementById('demoMain'),
  bridgePill: document.getElementById('bridgePill'),
  userPill: document.getElementById('userPill'),
  appPill: document.getElementById('appPill'),
  capPill: document.getElementById('capPill'),
  fileInput: document.getElementById('fileInput'),
  fileHint: document.getElementById('fileHint'),
  btnLoadSample: document.getElementById('btnLoadSample'),
  validateStat: document.getElementById('validateStat'),
  errorList: document.getElementById('errorList'),
  tableBody: document.getElementById('tableBody'),
  btnAskAi: document.getElementById('btnAskAi'),
  btnApply: document.getElementById('btnApply'),
  btnReupload: document.getElementById('btnReupload'),
  btnSubmit: document.getElementById('btnSubmit'),
  btnCancelAi: document.getElementById('btnCancelAi'),
  btnParsePaste: document.getElementById('btnParsePaste'),
  pasteBox: document.getElementById('pasteBox'),
  agentLog: document.getElementById('agentLog'),
  resultPanel: document.getElementById('resultPanel'),
  resultSummary: document.getElementById('resultSummary'),
  resultJson: document.getElementById('resultJson'),
  resultHint: document.getElementById('resultHint'),
  modeHeadless: document.getElementById('modeHeadless'),
  modeUi: document.getElementById('modeUi'),
};

function log(message) {
  const ts = new Date().toLocaleTimeString();
  el.agentLog.textContent = `[${ts}] ${message}\n${el.agentLog.textContent}`.slice(0, 4000);
}

function requireBridge() {
  if (state.bridgeAvailable) return true;
  alert('当前环境不支持 JSBridge。\n请在 SClaw 客户端应用广场中打开本页面（域名需为 *.sto.cn）。');
  log('拒绝调用：@sto/claw-bridge-sdk 检测不到 Bridge，请在 SClaw 内打开');
  return false;
}

function hasCompleteCapability() {
  return state.capabilities.includes('chat.complete');
}

function syncActionButtons() {
  const hasPatches = Boolean(state.patches?.patches?.length);
  el.btnApply.disabled = !hasPatches;
  const hasFixedRows = state.rows.some((r) => r.__fixed);
  el.btnReupload.disabled = !hasPatches && !hasFixedRows;
  el.btnCancelAi.hidden = !state.lastRequestId;
}

async function waitForBridge(timeoutMs = 12_000) {
  if (isStoClawBridgeAvailable()) return true;
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (isStoClawBridgeAvailable()) {
        resolve(true);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        resolve(false);
        return;
      }
      window.setTimeout(tick, 200);
    };
    const onReady = () => {
      if (isStoClawBridgeAvailable()) resolve(true);
    };
    window.stoClaw?.on?.('bridge:ready', onReady);
    tick();
  });
}

async function refreshEnv() {
  el.bridgePill.textContent = '检测 Bridge…';
  el.bridgePill.className = 'pill pill--unknown';
  log('等待 window.stoClaw（guest preload）…');

  state.bridgeAvailable = await waitForBridge();

  if (!state.bridgeAvailable) {
    if (el.bootStatus) el.bootStatus.hidden = true;
    el.unsupported.hidden = false;
    el.demoMain.hidden = true;
    el.bridgePill.textContent = '不支持 · 未注入 Bridge';
    el.bridgePill.className = 'pill pill--warn';
    el.userPill.textContent = '用户：—';
    el.appPill.textContent = '应用：—';
    if (el.capPill) el.capPill.textContent = '能力：—';
    log('未检测到 SClaw Bridge。请确认：1) 用含 JSBridge 的 SClaw 构建打开；2) 域名 *.sto.cn；3) 刷新页面。');
    return;
  }

  if (el.bootStatus) el.bootStatus.hidden = true;
  el.unsupported.hidden = true;
  el.demoMain.hidden = false;
  el.bridgePill.textContent = `SClaw Bridge 已连接 · SDK ${stoClaw.getVersion()}`;
  el.bridgePill.className = 'pill pill--ok';

  try {
    const user = await stoClaw.getUserInfo();
    el.userPill.textContent = `用户：${user.realName || user.userName || user.userId}`;
  } catch {
    el.userPill.textContent = '用户：未登录或无权限';
  }

  try {
    const app = await stoClaw.getAppInfo();
    el.appPill.textContent = `应用：${app.appId || '未绑定'} · ${app.trustTier || ''}`;
  } catch {
    el.appPill.textContent = '应用：—';
  }

  try {
    const caps = await stoClaw.getCapabilities();
    const list = Array.isArray(caps) ? caps : caps?.capabilities;
    state.capabilities = Array.isArray(list) ? list : [];
    const hasSend = state.capabilities.includes('chat.sendMessage');
    const hasComplete = hasCompleteCapability();
    if (el.capPill) {
      el.capPill.textContent = `能力：sendMessage ${hasSend ? '✓' : '✗'} · complete ${hasComplete ? '✓' : '✗'}`;
    }
    if (hasComplete && el.modeHeadless) {
      el.modeHeadless.checked = true;
    } else if (el.modeUi) {
      el.modeUi.checked = true;
      log('当前应用无 chat.complete（未开 AI Profile）。已切到 UI 联动；配置 bridgePolicy.ai.enabled 后可走结果回传。');
    }
  } catch {
    state.capabilities = [];
    if (el.capPill) el.capPill.textContent = '能力：查询失败';
  }

  log('Bridge 已就绪（@sto/claw-bridge-sdk@1.1.0）。加载示例 → AI 分析 → 应用修复 / 下载重新上传');
}

function normalizeHeader(h) {
  return String(h ?? '').trim();
}

function sheetToRows(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  return raw.map((row) => {
    const out = {};
    for (const col of COLS) {
      const hit = Object.keys(row).find((k) => normalizeHeader(k) === col);
      out[col] = hit != null ? String(row[hit]).trim() : '';
    }
    return out;
  });
}

function parseFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = new Uint8Array(reader.result);
        const wb = XLSX.read(data, { type: 'array' });
        resolve(sheetToRows(wb));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsArrayBuffer(file);
  });
}

function validateRows(rows) {
  const errors = [];
  const fieldErrors = {};
  const seen = new Map();

  const mark = (rowIndex, field, message) => {
    errors.push({ rowIndex, field, message });
    fieldErrors[`${rowIndex}:${field}`] = true;
  };

  rows.forEach((row, i) => {
    const line = i + 1;
    if (!row.客户编码) mark(i, '客户编码', `第 ${line} 行：客户编码不能为空`);
    if (!row.SKU) mark(i, 'SKU', `第 ${line} 行：SKU 不能为空`);

    if (row.单价 === '' || row.单价 == null) {
      mark(i, '单价', `第 ${line} 行：单价不能为空`);
    } else {
      const price = Number(row.单价);
      if (!Number.isFinite(price)) mark(i, '单价', `第 ${line} 行：单价不是有效数字`);
      else if (price <= 0) mark(i, '单价', `第 ${line} 行：单价必须大于 0（当前 ${row.单价}）`);
    }

    if (row.折扣率 !== '' && row.折扣率 != null) {
      const discount = Number(row.折扣率);
      if (!Number.isFinite(discount) || discount < 0 || discount > 1) {
        mark(i, '折扣率', `第 ${line} 行：折扣率需在 0~1（当前 ${row.折扣率}）`);
      }
    }

    if (!row.生效日期) {
      mark(i, '生效日期', `第 ${line} 行：生效日期不能为空`);
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(row.生效日期)) {
      mark(i, '生效日期', `第 ${line} 行：生效日期需为 YYYY-MM-DD（当前 ${row.生效日期}）`);
    }

    if (row.客户编码 && row.SKU) {
      const key = `${row.客户编码}::${row.SKU}`;
      if (seen.has(key)) {
        mark(i, 'SKU', `第 ${line} 行：与第 ${seen.get(key) + 1} 行「客户编码+SKU」重复`);
      } else {
        seen.set(key, i);
      }
    }
  });

  return { errors, fieldErrors };
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderTable() {
  if (!state.rows.length) {
    el.tableBody.innerHTML = '<tr class="empty"><td colspan="10">请先上传文件或加载示例</td></tr>';
    return;
  }

  el.tableBody.innerHTML = state.rows.map((row, i) => {
    const rowErrors = state.errors.filter((e) => e.rowIndex === i);
    const fixed = row.__fixed === true;
    const rowClass = fixed ? 'row--fixed' : rowErrors.length ? 'row--error' : '';
    const status = fixed
      ? '<span class="badge badge--fixed">已修复</span>'
      : rowErrors.length
        ? '<span class="badge badge--error">失败</span>'
        : '<span class="badge badge--ok">通过</span>';

    const cells = COLS.map((col) => {
      const key = `${i}:${col}`;
      const cls = state.fieldErrors[key]
        ? (fixed ? 'cell-fix' : 'cell-err')
        : (fixed && row.__patchedFields?.includes(col) ? 'cell-fix' : '');
      return `<td class="${cls}">${escapeHtml(row[col] ?? '')}</td>`;
    }).join('');

    return `<tr class="${rowClass}"><td>${i + 1}</td>${cells}<td>${status}</td></tr>`;
  }).join('');
}

function renderErrors() {
  el.errorList.innerHTML = state.errors
    .map((e) => `<li>${escapeHtml(e.message)}</li>`)
    .join('');

  if (!state.rows.length) {
    el.validateStat.textContent = '未校验';
    el.validateStat.className = 'stat';
  } else if (state.errors.length) {
    el.validateStat.textContent = `校验失败 · ${state.errors.length} 项`;
    el.validateStat.className = 'stat stat--fail';
  } else {
    el.validateStat.textContent = '校验通过';
    el.validateStat.className = 'stat stat--ok';
  }
}

function setDataset(rows, fileLabel) {
  if (!requireBridge()) return;

  state.rows = rows.map((r) => ({ ...r }));
  const result = validateRows(state.rows);
  state.errors = result.errors;
  state.fieldErrors = result.fieldErrors;
  state.patches = null;
  state.patchesPending = false;
  state.lastRequestId = null;

  el.fileHint.textContent = fileLabel;
  el.btnAskAi.disabled = state.errors.length === 0;
  el.btnSubmit.disabled = state.errors.length > 0;
  el.resultPanel.hidden = true;
  if (el.pasteBox) el.pasteBox.value = '';
  syncActionButtons();

  renderErrors();
  renderTable();
  log(`已加载 ${rows.length} 行，校验错误 ${state.errors.length} 项`);
}

function selectedMode() {
  return document.querySelector('input[name="aiMode"]:checked')?.value || 'headless';
}

function buildAiContext() {
  return {
    scene: 'quote-excel-import',
    fileName: el.fileHint.textContent,
    columns: COLS,
    rows: state.rows.map(({ __fixed, __patchedFields, ...rest }) => rest),
    validationErrors: state.errors,
    rules: [
      '客户编码、SKU、单价、生效日期必填',
      '单价为数字且 > 0',
      '折扣率 ∈ [0,1]',
      '生效日期格式 YYYY-MM-DD',
      '同一客户编码+SKU 不可重复（保留更合理的一行，另一行标记删除）',
    ],
  };
}

function buildPrompt() {
  return [
    '你是报价导入助手。页面已对 Excel 做本地校验且失败。',
    '请根据 validationErrors 与 rows 分析原因，并给出可执行的修复方案。',
    '请只返回一段 JSON（可用 ```json 代码块包裹），结构如下：',
    JSON.stringify({
      summary: '一句话总结',
      analysis: ['错误原因1', '错误原因2'],
      patches: [
        { rowIndex: 1, action: 'update', fields: { 单价: '13.5', 生效日期: '2026-09-01' }, reason: '补全单价并纠正日期' },
        { rowIndex: 4, action: 'delete', reason: '与第0行重复，删除后保留首条' },
      ],
      nextActions: ['用户确认后提交报价'],
    }, null, 2),
    '约束：rowIndex 为 0-based；只修复错误行；不要编造不存在的客户编码。',
  ].join('\n');
}

function tryParseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const m = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (m?.[1]) {
      try { return JSON.parse(m[1].trim()); } catch { /* ignore */ }
    }
  }
  return null;
}

function showAgentResult(parsed, meta = {}) {
  state.patches = parsed;
  state.patchesPending = Boolean(parsed?.patches?.length);
  state.lastRequestId = meta.requestId || null;

  el.resultPanel.hidden = false;
  el.resultSummary.textContent = parsed?.summary
    || meta.summary
    || '已收到结果';
  el.resultJson.textContent = JSON.stringify(parsed || meta, null, 2);
  if (el.resultHint) {
    el.resultHint.textContent = parsed?.patches?.length
      ? '结果已回到页面：点「应用修复到表格」写入当前表，或点「下载修复文件（重新上传）」导出后再用「选择文件」验证。'
      : (meta.hint || '未解析到 patches，可检查上方 JSON / 原文。');
  }
  syncActionButtons();
}

async function askAiUiMode(context) {
  const prompt = [
    '【报价 Excel 校验失败 · 请分析并给出修复建议】',
    '',
    buildPrompt(),
    '',
    '## context',
    '```json',
    JSON.stringify(context, null, 2),
    '```',
  ].join('\n');

  log('真实调用：stoClaw.openDrawer + stoClaw.sendMessage(target=embed)…');
  await stoClaw.openDrawer({ kind: 'chat' });
  await stoClaw.sendMessage({
    text: prompt,
    target: 'embed',
    openPanel: true,
  });

  el.resultPanel.hidden = false;
  el.resultSummary.textContent = '已发送到右侧 Embed 会话（无自动回传）。请复制回复中的 JSON 粘贴后解析。';
  el.resultJson.textContent = JSON.stringify({
    status: 'sent_to_embed_chat',
    sdk: '@sto/claw-bridge-sdk',
    hint: 'UI 联动不会把结果 Promise 回页面；需要完整回传请用 Headless complete',
    errorCount: context.validationErrors.length,
  }, null, 2);
  if (el.resultHint) {
    el.resultHint.textContent = 'UI 联动：从右侧复制 JSON → 粘贴 →「解析粘贴 JSON 并应用」。若要自动回传，请开启 AI Profile 后改用 Headless。';
  }
  state.patches = null;
  state.patchesPending = false;
  syncActionButtons();
  log('sendMessage 成功。UI 模式需粘贴 JSON；推荐改用 Headless 拿到 Promise 结果。');
}

async function askAiHeadless(context) {
  if (state.capabilities.length && !hasCompleteCapability()) {
    throw Object.assign(
      new Error('当前应用未授予 chat.complete（或未开启 AI Profile）。请改用「UI 联动」模式，或配置 bridgePolicy.ai.enabled。'),
      { code: 'CAPABILITY_DENIED' },
    );
  }

  log('真实调用：stoClaw.complete（Headless）→ 结果回页面…');
  const result = await stoClaw.complete({
    prompt: buildPrompt(),
    context,
    responseFormat: 'json',
    conversationId: 'quote-excel-demo',
    timeoutMs: 120_000,
  });

  const parsed = result.parsed || tryParseJson(result.text);
  if (!parsed?.patches?.length) {
    showAgentResult(parsed, {
      requestId: result.requestId,
      summary: parsed
        ? '模型已返回但缺少 patches'
        : `模型已返回但 JSON 解析失败：${result.parseError || 'unknown'}`,
      text: result.text,
      finishReason: result.finishReason,
      hint: '可检查 resultJson / 原文，或改用 UI 联动人工粘贴。',
    });
    log(`complete 完成但无可用 patches：finishReason=${result.finishReason}`);
    return;
  }

  showAgentResult(parsed, { requestId: result.requestId });
  log(`complete 成功 finishReason=${result.finishReason} · ${parsed.patches.length} 条 patches → 请点「应用修复」或「下载修复文件」`);
}

function applyPatches() {
  if (!state.patches?.patches?.length) {
    log('没有可应用的 patches');
    return false;
  }

  const deletes = new Set(
    state.patches.patches.filter((p) => p.action === 'delete').map((p) => p.rowIndex),
  );
  const updates = state.patches.patches.filter((p) => p.action !== 'delete');

  const next = state.rows.map((row, i) => {
    if (deletes.has(i)) return null;
    const patch = updates.find((p) => p.rowIndex === i);
    if (!patch?.fields) return { ...row };
    return {
      ...row,
      ...patch.fields,
      __fixed: true,
      __patchedFields: Object.keys(patch.fields),
    };
  }).filter(Boolean);

  state.rows = next;

  const result = validateRows(state.rows.map(({ __fixed, __patchedFields, ...rest }) => rest));
  state.errors = result.errors;
  state.fieldErrors = result.fieldErrors;

  state.rows = state.rows.map((row, i) => {
    const hasErr = state.errors.some((e) => e.rowIndex === i);
    if (hasErr) {
      const { __fixed, ...rest } = row;
      return rest;
    }
    return row.__patchedFields ? { ...row, __fixed: true } : row;
  });

  state.patchesPending = false;
  renderErrors();
  renderTable();
  el.btnSubmit.disabled = state.errors.length > 0;
  el.btnAskAi.disabled = state.errors.length === 0;
  syncActionButtons();
  log(state.errors.length
    ? `已应用修复，仍剩 ${state.errors.length} 项错误，可再次 AI 分析或下载当前结果重新上传`
    : '已应用修复，校验全部通过 — 可「下载修复文件」重新上传，或直接提交');
  return true;
}

function buildExportRows() {
  if (!state.patchesPending || !state.patches?.patches?.length) {
    return state.rows.map(({ __fixed, __patchedFields, ...rest }) => rest);
  }

  const deletes = new Set(
    state.patches.patches.filter((p) => p.action === 'delete').map((p) => p.rowIndex),
  );
  const updates = state.patches.patches.filter((p) => p.action !== 'delete');

  return state.rows
    .map((row, i) => {
      if (deletes.has(i)) return null;
      const patch = updates.find((p) => p.rowIndex === i);
      const { __fixed, __patchedFields, ...rest } = row;
      if (!patch?.fields) return rest;
      return { ...rest, ...patch.fields };
    })
    .filter(Boolean);
}

function downloadFixedFile() {
  if (!requireBridge()) return;

  if (state.patchesPending && state.patches?.patches?.length) {
    applyPatches();
  }

  const rows = buildExportRows();
  if (!rows.length) {
    alert('没有可导出的数据');
    return;
  }

  const ws = XLSX.utils.json_to_sheet(rows, { header: COLS });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '报价');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const filename = `quote-fixed-${stamp}.xlsx`;
  XLSX.writeFile(wb, filename);

  log(`已下载 ${filename}（${rows.length} 行）。可用「选择文件」重新上传验证，或继续提交。`);
  try {
    void stoClaw.toast({
      message: `已下载 ${filename}，可用「选择文件」重新上传`,
      level: 'success',
    });
  } catch {
    // toast optional
  }
}

function parsePasteAndApply() {
  if (!requireBridge()) return;
  const raw = el.pasteBox?.value?.trim();
  if (!raw) {
    alert('请先粘贴右侧 Agent 回复中的 JSON');
    return;
  }
  const parsed = tryParseJson(raw);
  if (!parsed?.patches?.length) {
    alert('未解析到 patches。请粘贴包含 patches 数组的 JSON。');
    log('粘贴 JSON 解析失败');
    return;
  }
  showAgentResult(parsed, { summary: parsed.summary || '已从粘贴内容解析 patches' });
  applyPatches();
}

async function submitQuote() {
  if (!requireBridge()) return;
  if (state.errors.length) {
    log('仍有校验错误，无法提交');
    return;
  }

  const payload = {
    submittedAt: new Date().toISOString(),
    rows: state.rows.map(({ __fixed, __patchedFields, ...rest }) => rest),
  };

  try {
    await stoClaw.call('storage.set', { key: 'quote-demo-last-submit', value: payload });
    await stoClaw.toast({ message: '报价已提交（已写入 Bridge Storage）', level: 'success' });
  } catch (err) {
    log(`提交 Storage/Toast 失败：${err.code || ''} ${err.message || err}`);
  }

  log(`提交成功 · ${payload.rows.length} 行`);
  el.btnSubmit.disabled = true;
}

// ── events ──

el.btnLoadSample.addEventListener('click', () => {
  setDataset(SAMPLE_ROWS, '示例坏数据 · fixtures/sample-quote-invalid.csv');
});

el.fileInput.addEventListener('change', async (ev) => {
  if (!requireBridge()) {
    ev.target.value = '';
    return;
  }
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    const rows = await parseFile(file);
    if (!rows.length) throw new Error('未解析到数据行');
    setDataset(rows, `已上传：${file.name}（${Math.round(file.size / 1024)} KB）`);
  } catch (err) {
    log(`解析失败：${err.message || err}`);
    alert(`文件解析失败：${err.message || err}`);
  } finally {
    ev.target.value = '';
  }
});

el.btnAskAi.addEventListener('click', async () => {
  if (!requireBridge()) return;
  if (!state.errors.length) return;

  el.btnAskAi.disabled = true;
  const context = buildAiContext();
  const mode = selectedMode();

  try {
    if (mode === 'ui') await askAiUiMode(context);
    else await askAiHeadless(context);
  } catch (err) {
    const code = err instanceof StoClawBridgeError || err.code ? `[${err.code || 'ERROR'}] ` : '';
    log(`AI 调用失败：${code}${err.message || err}`);
    alert(`AI 调用失败：${code}${err.message || err}\n\n请确认在 SClaw 内打开，且已登录；UI 模式需 chat.sendMessage，Headless 需 AI Profile（bridgePolicy.ai.enabled）。`);
  } finally {
    el.btnAskAi.disabled = state.errors.length === 0;
  }
});

el.btnApply.addEventListener('click', () => {
  if (!requireBridge()) return;
  applyPatches();
});

el.btnReupload?.addEventListener('click', () => {
  downloadFixedFile();
});

el.btnSubmit.addEventListener('click', () => { void submitQuote(); });

el.btnParsePaste?.addEventListener('click', () => parsePasteAndApply());

el.btnCancelAi.addEventListener('click', async () => {
  if (!requireBridge() || !state.lastRequestId) return;
  try {
    await stoClaw.cancel({ requestId: state.lastRequestId });
    log(`已取消 requestId=${state.lastRequestId}`);
  } catch (err) {
    log(`取消失败：${err.code || ''} ${err.message || err}`);
  }
});

void refreshEnv();
