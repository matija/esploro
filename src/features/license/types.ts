export type LicenseTier = 'Personal' | 'Commercial' | 'Unlicensed';

export interface LicenseStatus {
  tier: LicenseTier;
  bannerVisible: boolean;
  gracePeriodEnds: string | null;
  showUsageDialog: boolean;
  revalidationRequired: boolean;
}
