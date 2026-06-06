import { commands } from "../../lib/bindings";
import { normalizeError } from "../../lib/ipc";
import type { LicenseStatus } from './types';

export const LICENSE_STATUS_KEY = ['license-status'] as const;

async function normalizeCommandError<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (raw) {
    throw normalizeError(raw);
  }
}

export const licenseApi = {
  getStatus: (): Promise<LicenseStatus> =>
    normalizeCommandError(commands.getLicenseStatus()),
  activate: (key: string): Promise<LicenseStatus> =>
    normalizeCommandError(commands.activateLicense(key)),
  deactivate: (): Promise<LicenseStatus> =>
    normalizeCommandError(commands.deactivateLicense()),
  answerUsageDialog: (answer: 'personal' | 'commercial') =>
    normalizeCommandError(commands.answerUsageDialog(answer)),
  dismissBanner: () =>
    normalizeCommandError(commands.dismissLicenseBanner()).then(() => undefined),
  notifyConnectionCount: (count: number) =>
    normalizeCommandError(commands.notifyConnectionCount(count)),
  openUrl: (url: string): Promise<void> =>
    normalizeCommandError(commands.openUrl(url)).then(() => undefined),
  openPricingPage: () =>
    licenseApi.openUrl('https://esploro.app/pricing'),
  openCustomerPortal: () =>
    normalizeCommandError(commands.openCustomerPortal()).then(() => undefined),
};
