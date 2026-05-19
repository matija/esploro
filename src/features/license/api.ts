import { invoke } from '@tauri-apps/api/core';
import type {
  BuildFlavor,
  IapEntitlement,
  IapProduct,
  IapPurchaseResult,
  IapRestoreResult,
  LicenseStatus,
} from './types';

export const LICENSE_STATUS_KEY = ['license-status'] as const;
export const BUILD_FLAVOR_KEY = ['build-flavor'] as const;
export const IAP_PRODUCTS_KEY = ['iap-products'] as const;
export const IAP_ENTITLEMENT_KEY = ['iap-entitlement'] as const;

/// Apple's deep link to the user's subscription management screen on macOS.
/// `macappstore://` opens the Mac App Store app directly; falling back to the
/// `https://` URL would route through a browser → App Store handoff.
const MANAGE_SUBSCRIPTIONS_URL =
  'macappstore://apps.apple.com/account/subscriptions';

export const licenseApi = {
  // Both builds.
  getStatus: () => invoke<LicenseStatus>('get_license_status'),
  getBuildFlavor: () => invoke<BuildFlavor>('get_build_flavor'),
  answerUsageDialog: (answer: 'personal' | 'commercial') =>
    invoke<LicenseStatus>('answer_usage_dialog', { answer }),
  dismissBanner: () => invoke<void>('dismiss_license_banner'),
  notifyConnectionCount: (count: number) =>
    invoke<LicenseStatus>('notify_connection_count', { count }),
  openPricingPage: () => invoke<void>('open_url', { url: 'https://esploro.app/pricing' }),

  // Direct build only — calls fail at runtime on the MAS binary because the
  // commands aren't registered there.
  activate: (key: string) => invoke<LicenseStatus>('activate_license', { key }),
  deactivate: () => invoke<LicenseStatus>('deactivate_license'),
  openCustomerPortal: () => invoke<void>('open_customer_portal'),

  // MAS build only — same caveat in the opposite direction.
  getProducts: () => invoke<IapProduct[]>('iap_get_products'),
  purchase: (productId: string) =>
    invoke<IapPurchaseResult>('iap_purchase', { productId }),
  restore: () => invoke<IapRestoreResult>('iap_restore'),
  checkEntitlement: () => invoke<IapEntitlement>('iap_check_entitlement'),
  openManageSubscription: () =>
    invoke<void>('open_url', { url: MANAGE_SUBSCRIPTIONS_URL }),
};
