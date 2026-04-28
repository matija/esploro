import { invoke } from '@tauri-apps/api/core';
import type { LicenseStatus } from './types';

export const LICENSE_STATUS_KEY = ['license-status'] as const;

export const licenseApi = {
  getStatus: () => invoke<LicenseStatus>('get_license_status'),
  activate: (key: string) => invoke<LicenseStatus>('activate_license', { key }),
  deactivate: () => invoke<LicenseStatus>('deactivate_license'),
  answerUsageDialog: (answer: 'personal' | 'commercial') =>
    invoke<LicenseStatus>('answer_usage_dialog', { answer }),
  dismissBanner: () => invoke<void>('dismiss_license_banner'),
  notifyConnectionCount: (count: number) =>
    invoke<LicenseStatus>('notify_connection_count', { count }),
  openLicenseUrl: () => invoke<void>('open_license_url'),
};
