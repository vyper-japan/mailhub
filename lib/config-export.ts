import "server-only";

import { getResolvedConfigStoreType } from "@/lib/configStore";
import { getMailhubEnv } from "@/lib/mailhub-env";
import { getVersionInfo } from "@/lib/version";
import type { RegisteredLabel } from "@/lib/labelRegistryStore";
import type { LabelRule } from "@/lib/labelRules";
import type { AssigneeEntry } from "@/lib/assigneeRegistryStore";

export type MailhubConfigExport = {
  exportedAt: string; // ISO
  configStoreType: ReturnType<typeof getResolvedConfigStoreType>;
  version: ReturnType<typeof getVersionInfo>;
  labels: RegisteredLabel[];
  rules: LabelRule[];
  assignees: AssigneeEntry[]; // Step 82: 担当者名簿
  meta: {
    env: "local" | "staging" | "production";
    counts: { labels: number; rules: number; assignees: number };
  };
};

/**
 * Config Export payload builder
 * - 秘密情報を含めない（envやsecret類は入れない）
 * - 副作用ゼロ（read-only）
 */
export function buildConfigExportPayload(params: { labels: RegisteredLabel[]; rules: LabelRule[]; assignees: AssigneeEntry[] }): MailhubConfigExport {
  return {
    exportedAt: new Date().toISOString(),
    configStoreType: getResolvedConfigStoreType(),
    version: getVersionInfo(),
    labels: params.labels,
    rules: params.rules,
    assignees: params.assignees,
    meta: {
      env: getMailhubEnv(),
      counts: {
        labels: params.labels.length,
        rules: params.rules.length,
        assignees: params.assignees.length,
      },
    },
  };
}

export function buildConfigExportFilename(): string {
  const env = getMailhubEnv(); // local|staging|production
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  return `mailhub-config-${env}-${y}${m}${d}-${hh}${mm}${ss}.json`;
}

