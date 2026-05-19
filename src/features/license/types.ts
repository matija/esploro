export type LicenseTier = 'Personal' | 'Commercial' | 'Unlicensed';

export interface LicenseStatus {
  tier: LicenseTier;
  bannerVisible: boolean;
  gracePeriodEnds: string | null;
  showUsageDialog: boolean;
  revalidationRequired: boolean;
}

/// Identifies which binary flavour is running. The Direct build is shipped via
/// GitHub Releases / Homebrew with Dodo Payments; the MAS build is shipped via
/// the Mac App Store with StoreKit IAP. The frontend ships a single bundle and
/// picks the right UI by querying `get_build_flavor` once at startup.
export type BuildFlavor = 'direct' | 'mas';

export interface IapProduct {
  id: string;
  title: string;
  description: string;
  /** Already localised + currency-formatted by StoreKit (e.g. `"$129.00"`). */
  price: string;
}

export type IapPurchaseStatus = 'purchased' | 'cancelled' | 'failed';

export interface IapPurchaseResult {
  status: IapPurchaseStatus;
}

export interface IapRestoreResult {
  restored: boolean;
}

export interface IapEntitlement {
  entitled: boolean;
  productId: string | null;
  /** RFC 3339 timestamp; `null` for non-consumable lifetime products. */
  expiresAt: string | null;
}
