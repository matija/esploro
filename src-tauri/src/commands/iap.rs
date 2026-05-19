//! In-App Purchase commands for the Mac App Store build.
//!
//! This module is only compiled when the `mas` cargo feature is enabled.
//! It exposes a small Tauri command surface mirroring the IAP product matrix
//! described in `PRD.md` (P2 — StoreKit IAP Integration). The four commands
//! are the migration boundary between the Rust backend and the frontend; the
//! actual StoreKit 1 (`objc2-store-kit`) integration lands in a follow-up
//! task. For now each command returns `Err("not yet implemented")` so the
//! shape of the API can be wired into `lib.rs` and the frontend without
//! coupling to the StoreKit work.
//!
//! Companion design docs:
//! - `plans/08-mas-adr.md` — Mac App Store distribution decision
//! - `plans/09-storekit-objc2.md` — `objc2-store-kit` over a Swift plugin
//! - `PRD.md` § P2 — command surface and license-layer changes

use serde::{Deserialize, Serialize};

use super::iap_storekit;

const KEYCHAIN_SERVICE: &str = "app.esploro";
const KEYCHAIN_ACCOUNT_ENTITLEMENT: &str = "mas-entitlement";

/// IAP product identifiers registered in App Store Connect. The MAS build
/// queries these three on every `iap_get_products` call; the App Store will
/// reject any IDs not configured on the listing so the client side just
/// hard-codes the canonical list.
pub const PRODUCT_IDS: &[&str] = &[
    "app.esploro.personal.lifetime",
    "app.esploro.personal.annual",
    "app.esploro.business.annual",
];

// ---------------------------------------------------------------------------
// Wire types — kept in sync with the PRD's `iap_*` command return shapes.
// ---------------------------------------------------------------------------

/// One purchasable product fetched from the App Store at runtime.
///
/// `price` is the localised, currency-formatted string (e.g. `"$129.00"`).
/// StoreKit hands us this directly via `SKProduct.priceLocale`, so we keep it
/// pre-formatted on the Rust side rather than shipping numeric prices the
/// frontend would have to format with `Intl`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IapProduct {
    pub id: String,
    pub title: String,
    pub description: String,
    pub price: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum IapPurchaseStatus {
    Purchased,
    Cancelled,
    Failed,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IapPurchaseResult {
    pub status: IapPurchaseStatus,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IapRestoreResult {
    pub restored: bool,
}

/// Result of `iap_check_entitlement`. `expires_at` is `None` for the
/// non-consumable lifetime product and `Some(rfc3339)` for subscriptions.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct IapEntitlement {
    pub entitled: bool,
    pub product_id: Option<String>,
    pub expires_at: Option<String>,
}

// ---------------------------------------------------------------------------
// Cached entitlement — replaces `StoredLicense` on the MAS build.
// ---------------------------------------------------------------------------

/// Last-known IAP entitlement, cached in the macOS Keychain so the app can
/// render the correct license tier offline / on launch before re-querying
/// `SKPaymentQueue` for fresh transactions.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct StoredEntitlement {
    pub product_id: String,
    pub expires_at: Option<String>,
}

pub(crate) fn read_stored_entitlement() -> Option<StoredEntitlement> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_ENTITLEMENT).ok()?;
    match entry.get_password() {
        Ok(json) => serde_json::from_str(&json).ok(),
        Err(keyring::Error::NoEntry) => None,
        Err(e) => {
            eprintln!("Failed to read MAS entitlement from keychain: {e}");
            None
        }
    }
}

pub(crate) fn write_stored_entitlement(stored: &StoredEntitlement) -> Result<(), String> {
    let json = serde_json::to_string(stored).map_err(|e| e.to_string())?;
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_ENTITLEMENT)
        .map_err(|e| e.to_string())?;
    entry.set_password(&json).map_err(|e| e.to_string())
}

#[allow(dead_code)]
pub(crate) fn clear_stored_entitlement() {
    if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_ENTITLEMENT) {
        entry.delete_password().ok();
    }
}

// ---------------------------------------------------------------------------
// Tauri commands — delegate to `iap_storekit` for the live StoreKit work and
// translate cached entitlement state for the entitlement check.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn iap_get_products() -> Result<Vec<IapProduct>, String> {
    iap_storekit::fetch_products(PRODUCT_IDS.iter().map(|s| s.to_string()).collect()).await
}

#[tauri::command]
pub async fn iap_purchase(product_id: String) -> Result<IapPurchaseResult, String> {
    iap_storekit::purchase(product_id).await
}

#[tauri::command]
pub async fn iap_restore() -> Result<IapRestoreResult, String> {
    iap_storekit::restore().await
}

/// Reads the cached entitlement from the Keychain and translates it into the
/// wire shape the frontend consumes. Subscription expiry is checked against
/// `Utc::now()` so a lapsed subscription is reported as `entitled: false`
/// without having to walk the StoreKit transaction queue. Fresh transactions
/// (renewals, restores) flow through the `SKPaymentTransactionObserver` in
/// `iap_storekit` and update this cache on the fly.
#[tauri::command]
pub async fn iap_check_entitlement() -> Result<IapEntitlement, String> {
    let Some(stored) = read_stored_entitlement() else {
        return Ok(IapEntitlement::default());
    };
    let now = chrono::Utc::now();
    let entitled = match stored.expires_at.as_deref() {
        None => true, // Non-consumable (lifetime) — always entitled.
        Some(raw) => match chrono::DateTime::parse_from_rfc3339(raw) {
            Ok(dt) => dt.with_timezone(&chrono::Utc) > now,
            Err(_) => false,
        },
    };
    Ok(IapEntitlement {
        entitled,
        product_id: Some(stored.product_id),
        expires_at: stored.expires_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iap_purchase_status_serialises_as_lowercase_strings() {
        let purchased = serde_json::to_string(&IapPurchaseResult {
            status: IapPurchaseStatus::Purchased,
        })
        .unwrap();
        assert_eq!(purchased, r#"{"status":"purchased"}"#);

        let cancelled = serde_json::to_string(&IapPurchaseResult {
            status: IapPurchaseStatus::Cancelled,
        })
        .unwrap();
        assert_eq!(cancelled, r#"{"status":"cancelled"}"#);

        let failed = serde_json::to_string(&IapPurchaseResult {
            status: IapPurchaseStatus::Failed,
        })
        .unwrap();
        assert_eq!(failed, r#"{"status":"failed"}"#);
    }

    #[test]
    fn iap_entitlement_omits_camel_case_fields_when_none() {
        let unentitled = IapEntitlement::default();
        let json = serde_json::to_string(&unentitled).unwrap();
        // `expiresAt` (camelCase) must appear when serialised — None becomes null.
        assert_eq!(json, r#"{"entitled":false,"productId":null,"expiresAt":null}"#);
    }

    #[test]
    fn iap_product_uses_camel_case_keys() {
        let product = IapProduct {
            id: "app.esploro.personal.lifetime".to_string(),
            title: "Personal — Lifetime".to_string(),
            description: "One-time individual commercial license".to_string(),
            price: "$129.00".to_string(),
        };
        let json = serde_json::to_value(&product).unwrap();
        let obj = json.as_object().expect("object");
        assert!(obj.contains_key("id"));
        assert!(obj.contains_key("title"));
        assert!(obj.contains_key("description"));
        assert!(obj.contains_key("price"));
    }

    #[test]
    fn stored_entitlement_roundtrips_through_json() {
        let stored = StoredEntitlement {
            product_id: "app.esploro.business.annual".to_string(),
            expires_at: Some("2027-05-18T00:00:00+00:00".to_string()),
        };
        let json = serde_json::to_string(&stored).unwrap();
        let parsed: StoredEntitlement = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, stored);
    }
}
