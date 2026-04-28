export type LicenseTier = 'Personal' | 'Commercial' | 'Unlicensed';

export interface LicenseStatus {
  tier: LicenseTier;
  licensee: string | null;
  expiresAt: string | null;
  daysUntilExpiry: number | null;
  bannerVisible: boolean;
  gracePeriodEnds: string | null;
  showUsageDialog: boolean;
}
