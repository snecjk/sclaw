/**
 * TEMP / workaround — do not treat as long-term design.
 *
 * OpenClaw scheduled tasks may stick to a stale `payload.model` and ignore the
 * current workspace/agent default. Until that is fixed properly (e.g. resolve
 * model at run time / via cron.update), STO model-sync rewrites every job's
 * `payload.model` in ~/.stoclaw/openclaw/cron/jobs.json to `sto/<firstCatalogId>`.
 *
 * Only mutates that field; all other job / payload keys stay untouched.
 * Remove this module once OpenClaw cron model selection is corrected upstream.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getOpenClawConfigDir } from './paths';
import { logger } from './logger';

interface CronJobPayload {
  model?: string;
  [key: string]: unknown;
}

interface CronJobsDocument {
  jobs?: Array<{
    payload?: CronJobPayload;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

/** Qualify catalog model id for cron payload: `sto/<modelId>`. */
function withStoCronModelPrefix(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('sto/') ? trimmed : `sto/${trimmed}`;
}

/**
 * TEMP: patch all cron `payload.model` values to `sto/<modelId>`.
 * Temporary mitigation for OpenClaw scheduled-task model selection bugs.
 * Skips entries without an object payload. No-op when nothing changes.
 */
export async function syncOpenClawCronFirstJobModel(modelId: string): Promise<boolean> {
  const trimmed = withStoCronModelPrefix(modelId);
  if (!trimmed) return false;

  const jobsPath = join(getOpenClawConfigDir(), 'cron', 'jobs.json');
  let raw: string;
  try {
    raw = await readFile(jobsPath, 'utf8');
  } catch {
    return false;
  }

  let data: CronJobsDocument;
  try {
    data = JSON.parse(raw) as CronJobsDocument;
  } catch (err) {
    logger.warn('[openclaw-cron] jobs.json parse failed; skip jobs model sync', err);
    return false;
  }

  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  if (jobs.length === 0) {
    return false;
  }

  let changed = 0;
  for (const job of jobs) {
    if (!job || typeof job !== 'object') continue;
    // Do not invent payload — only rewrite an existing payload object.
    if (!job.payload || typeof job.payload !== 'object' || Array.isArray(job.payload)) {
      continue;
    }

    const current =
      typeof job.payload.model === 'string' ? job.payload.model.trim() : '';
    if (current === trimmed) continue;

    job.payload.model = trimmed;
    changed += 1;
  }

  if (changed === 0) {
    return false;
  }

  try {
    await mkdir(dirname(jobsPath), { recursive: true });
    const tmpPath = `${jobsPath}.${randomUUID()}.tmp`;
    await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    await rename(tmpPath, jobsPath);
    logger.info(
      `[openclaw-cron] synced ${changed}/${jobs.length} job payload.model -> ${trimmed}`,
    );
    return true;
  } catch (err) {
    logger.warn('[openclaw-cron] failed to write jobs payload.model', err);
    return false;
  }
}
