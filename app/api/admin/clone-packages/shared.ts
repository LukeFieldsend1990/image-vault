export interface CloneRunRecord {
  runAt: number;
  triggeredBy: string;
  sourceEmail: string;
  targetEmail: string;
  summary: { packages: number; files: number; filesFailed: number; tags: number; skipped: number };
}

export interface ClonePackageItem {
  id: string;
  name: string;
}

export interface FileToCopy {
  fileId: string;
  sourceKey: string;
  destKey: string;
}

export function todayKey(): string {
  return `clone_packages:daily:${new Date().toISOString().slice(0, 10)}`;
}
