//! StoreKit 1 (SKProductsRequest / SKPaymentQueue) wiring for the MAS build.
//!
//! This module is compiled only when `--features mas` is active and on
//! `target_os = "macos"` (see Cargo.toml).
//!
//! It owns a single Obj-C delegate instance (`EsploroStoreKitDelegate`) that
//! conforms to:
//!   - `SKProductsRequestDelegate` — fetches localised product metadata
//!   - `SKRequestDelegate` (supertrait) — handles request-level errors
//!   - `SKPaymentTransactionObserver` — receives purchase/restore updates
//!
//! The delegate is registered with `SKPaymentQueue.defaultQueue` exactly once
//! per process via a `OnceLock`. From that point on, every transaction the
//! payment queue delivers — including pending transactions re-queued from a
//! previous app launch, and renewal transactions for active subscriptions —
//! flows through `payment_queue_updated_transactions`, which updates the
//! cached `StoredEntitlement` in the Keychain and resolves any in-flight
//! purchase/restore request waiting on a Tokio oneshot channel.
//!
//! Tauri commands (declared in `iap.rs`) run on the Tokio runtime and call
//! into this module's async functions. The async functions install a oneshot
//! sender in the shared `DelegateState`, kick off the StoreKit operation, and
//! await the response that the Obj-C callbacks push back through that sender.
//! StoreKit 1 delivers all its callbacks on the main thread; the channels
//! cross that thread boundary safely.
//!
//! Every StoreKit 1 symbol used here is `#[deprecated]` upstream (Apple
//! marked the whole API in favour of StoreKit 2's Swift `Product` API).
//! The `#![allow(deprecated)]` at the top of the module silences those
//! warnings — the migration to StoreKit 2 / a Swift plugin is captured as
//! a future ADR (see `plans/09-storekit-objc2.md`).
#![allow(deprecated)]

use std::sync::{Mutex, OnceLock};

use chrono::{DateTime, Months, Utc};
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{define_class, msg_send, AnyThread, DefinedClass, MainThreadMarker};
use objc2_foundation::{
    NSArray, NSDate, NSDecimalNumber, NSError, NSLocale, NSNumberFormatter, NSNumberFormatterStyle,
    NSObject, NSObjectProtocol, NSSet, NSString,
};
use objc2_store_kit::{
    SKErrorCode, SKPayment, SKPaymentQueue, SKPaymentTransaction, SKPaymentTransactionObserver,
    SKPaymentTransactionState, SKProduct, SKProductPeriodUnit, SKProductsRequest,
    SKProductsRequestDelegate, SKProductsResponse, SKRequest, SKRequestDelegate,
};
use tokio::sync::oneshot;

use super::iap::{
    write_stored_entitlement, IapProduct, IapPurchaseResult, IapPurchaseStatus, IapRestoreResult,
    StoredEntitlement,
};

// ---------------------------------------------------------------------------
// Pending-operation state owned by the delegate's ivars.
// ---------------------------------------------------------------------------

struct PendingPurchase {
    product_id: String,
    sender: oneshot::Sender<Result<IapPurchaseResult, String>>,
}

struct PendingRestore {
    sender: oneshot::Sender<Result<bool, String>>,
    restored_any: bool,
}

type ProductsSender = oneshot::Sender<Result<Vec<IapProduct>, String>>;

pub struct DelegateState {
    /// Active products request — one at a time. `start()` is non-blocking and
    /// fires `productsRequest:didReceiveResponse:` (or the SKRequestDelegate
    /// failure callback) which resolves this oneshot.
    pending_products: Mutex<Option<ProductsSender>>,
    /// Active purchase — at most one. Resolved when a transaction with the
    /// matching `productIdentifier` reaches `Purchased`/`Failed`. Other
    /// (background) transactions for the same product are still observed and
    /// finished, they just don't satisfy this future.
    pending_purchase: Mutex<Option<PendingPurchase>>,
    /// Active restore — at most one. Resolved by either
    /// `paymentQueueRestoreCompletedTransactionsFinished:` (success, possibly
    /// with zero restored transactions) or the corresponding failure
    /// callback.
    pending_restore: Mutex<Option<PendingRestore>>,
    /// `SKProduct` objects cached from the most recent products request. We
    /// hold these to (a) initiate purchases (need the `SKProduct`, not just
    /// the identifier, for `SKPayment.paymentWithProduct:`) and (b) read
    /// `subscriptionPeriod` when computing expiry timestamps for cached
    /// entitlements.
    cached_products: Mutex<Vec<Retained<SKProduct>>>,
    /// The in-flight `SKProductsRequest`, retained so it isn't released
    /// before its delegate callback fires.
    active_request: Mutex<Option<Retained<SKProductsRequest>>>,
}

// ---------------------------------------------------------------------------
// Custom delegate class — implements three Obj-C protocols.
// ---------------------------------------------------------------------------

define_class!(
    /// Single instance, owned by `Manager`, registered as the
    /// `SKPaymentQueue.defaultQueue` transaction observer for the life of the
    /// process.
    ///
    /// SAFETY:
    /// - Superclass is plain `NSObject` (no subclassing requirements).
    /// - We do not implement `Drop`. The Obj-C runtime is allowed to call
    ///   `dealloc` from any thread; our ivars are `Send + Sync` (mutex-wrapped
    ///   tokio oneshots and `Retained<SKProduct>` / `Retained<SKProductsRequest>`,
    ///   the latter two of which the objc2-store-kit bindings explicitly mark
    ///   `Send + Sync`).
    #[unsafe(super(NSObject))]
    #[name = "EsploroStoreKitDelegate"]
    #[ivars = DelegateState]
    pub struct EsploroStoreKitDelegate;

    unsafe impl NSObjectProtocol for EsploroStoreKitDelegate {}

    unsafe impl SKRequestDelegate for EsploroStoreKitDelegate {
        #[unsafe(method(request:didFailWithError:))]
        fn request_did_fail_with_error(&self, _request: &SKRequest, error: &NSError) {
            let msg = format_ns_error(error);
            if let Some(tx) = self.ivars().pending_products.lock().unwrap().take() {
                let _ = tx.send(Err(msg));
            }
            *self.ivars().active_request.lock().unwrap() = None;
        }
    }

    unsafe impl SKProductsRequestDelegate for EsploroStoreKitDelegate {
        #[unsafe(method(productsRequest:didReceiveResponse:))]
        fn products_request_did_receive_response(
            &self,
            _request: &SKProductsRequest,
            response: &SKProductsResponse,
        ) {
            let products = unsafe { response.products() };
            let mut wire = Vec::with_capacity(products.len());
            let mut retained: Vec<Retained<SKProduct>> = Vec::with_capacity(products.len());
            for product in products.iter() {
                if let Some(iap) = product_to_wire(&product) {
                    wire.push(iap);
                }
                retained.push(product.clone());
            }
            *self.ivars().cached_products.lock().unwrap() = retained;
            if let Some(tx) = self.ivars().pending_products.lock().unwrap().take() {
                let _ = tx.send(Ok(wire));
            }
            *self.ivars().active_request.lock().unwrap() = None;
        }
    }

    unsafe impl SKPaymentTransactionObserver for EsploroStoreKitDelegate {
        #[unsafe(method(paymentQueue:updatedTransactions:))]
        fn payment_queue_updated_transactions(
            &self,
            queue: &SKPaymentQueue,
            transactions: &NSArray<SKPaymentTransaction>,
        ) {
            self.handle_updated_transactions(queue, transactions);
        }

        #[unsafe(method(paymentQueueRestoreCompletedTransactionsFinished:))]
        fn payment_queue_restore_completed_transactions_finished(&self, _queue: &SKPaymentQueue) {
            if let Some(state) = self.ivars().pending_restore.lock().unwrap().take() {
                let _ = state.sender.send(Ok(state.restored_any));
            }
        }

        #[unsafe(method(paymentQueue:restoreCompletedTransactionsFailedWithError:))]
        fn payment_queue_restore_completed_transactions_failed_with_error(
            &self,
            _queue: &SKPaymentQueue,
            error: &NSError,
        ) {
            let msg = format_ns_error(error);
            if let Some(state) = self.ivars().pending_restore.lock().unwrap().take() {
                let _ = state.sender.send(Err(msg));
            }
        }
    }
);

impl EsploroStoreKitDelegate {
    fn new() -> Retained<Self> {
        let state = DelegateState {
            pending_products: Mutex::new(None),
            pending_purchase: Mutex::new(None),
            pending_restore: Mutex::new(None),
            cached_products: Mutex::new(Vec::new()),
            active_request: Mutex::new(None),
        };
        let this = Self::alloc().set_ivars(state);
        unsafe { msg_send![super(this), init] }
    }

    fn handle_updated_transactions(
        &self,
        queue: &SKPaymentQueue,
        transactions: &NSArray<SKPaymentTransaction>,
    ) {
        for txn in transactions.iter() {
            let state = unsafe { txn.transactionState() };
            match state {
                SKPaymentTransactionState::Purchasing | SKPaymentTransactionState::Deferred => {
                    continue
                }
                SKPaymentTransactionState::Purchased
                | SKPaymentTransactionState::Restored => {
                    let payment = unsafe { txn.payment() };
                    let product_id_ns = unsafe { payment.productIdentifier() };
                    let product_id = product_id_ns.to_string();
                    let txn_date = unsafe { txn.transactionDate() };
                    let entitlement = self
                        .entitlement_from_transaction(&product_id, txn_date.as_deref());
                    let _ = write_stored_entitlement(&entitlement);

                    if state == SKPaymentTransactionState::Purchased {
                        self.resolve_purchase(
                            &product_id,
                            Ok(IapPurchaseResult {
                                status: IapPurchaseStatus::Purchased,
                            }),
                        );
                    } else {
                        let mut pending = self.ivars().pending_restore.lock().unwrap();
                        if let Some(s) = pending.as_mut() {
                            s.restored_any = true;
                        }
                    }
                    unsafe { queue.finishTransaction(&txn); }
                }
                SKPaymentTransactionState::Failed => {
                    let payment = unsafe { txn.payment() };
                    let product_id_ns = unsafe { payment.productIdentifier() };
                    let product_id = product_id_ns.to_string();
                    let cancelled = unsafe { txn.error() }
                        .map(|e| e.code() == SKErrorCode::PaymentCancelled.0)
                        .unwrap_or(false);
                    let status = if cancelled {
                        IapPurchaseStatus::Cancelled
                    } else {
                        IapPurchaseStatus::Failed
                    };
                    self.resolve_purchase(&product_id, Ok(IapPurchaseResult { status }));
                    unsafe { queue.finishTransaction(&txn); }
                }
                _ => continue,
            }
        }
    }

    fn resolve_purchase(
        &self,
        product_id: &str,
        result: Result<IapPurchaseResult, String>,
    ) {
        let mut pending = self.ivars().pending_purchase.lock().unwrap();
        let matches = pending
            .as_ref()
            .map(|p| p.product_id == product_id)
            .unwrap_or(false);
        if matches {
            if let Some(p) = pending.take() {
                let _ = p.sender.send(result);
            }
        }
    }

    fn entitlement_from_transaction(
        &self,
        product_id: &str,
        txn_date: Option<&NSDate>,
    ) -> StoredEntitlement {
        let cached = self.ivars().cached_products.lock().unwrap();
        StoredEntitlement {
            product_id: product_id.to_string(),
            expires_at: compute_expires_at(product_id, txn_date, &cached),
        }
    }
}

// ---------------------------------------------------------------------------
// Singleton manager + lazy-install of the transaction observer.
// ---------------------------------------------------------------------------

pub struct Manager {
    delegate: Retained<EsploroStoreKitDelegate>,
}

// SAFETY: `EsploroStoreKitDelegate`'s ivars are all `Send + Sync` (mutexes
// containing oneshot senders + Retained<SKProduct>/Retained<SKProductsRequest>,
// both of which the bindings mark `Send + Sync`). The `Retained<>` wrapper is
// `Send + Sync` iff its target is. Holding the manager in a static `OnceLock`
// across threads is therefore sound.
unsafe impl Send for Manager {}
unsafe impl Sync for Manager {}

static MANAGER: OnceLock<Manager> = OnceLock::new();

fn manager() -> &'static Manager {
    MANAGER.get_or_init(|| {
        let delegate = EsploroStoreKitDelegate::new();
        unsafe {
            // `SKPaymentQueue.addTransactionObserver:` strongly retains the
            // observer for the queue's lifetime; we additionally hold one
            // reference on the manager to keep our Rust-side handle valid.
            let queue = SKPaymentQueue::defaultQueue();
            queue.addTransactionObserver(ProtocolObject::from_ref(&*delegate));
        }
        Manager { delegate }
    })
}

// ---------------------------------------------------------------------------
// Public API consumed by `iap.rs`.
// ---------------------------------------------------------------------------

pub async fn fetch_products(ids: Vec<String>) -> Result<Vec<IapProduct>, String> {
    let mgr = manager();
    let (tx, rx) = oneshot::channel();
    {
        let mut pending = mgr.delegate.ivars().pending_products.lock().unwrap();
        if pending.is_some() {
            return Err("Another products fetch is already in progress".to_string());
        }
        *pending = Some(tx);
    }

    unsafe {
        let ns_ids: Vec<Retained<NSString>> = ids.iter().map(|s| NSString::from_str(s)).collect();
        let ns_set: Retained<NSSet<NSString>> = NSSet::from_retained_slice(&ns_ids);
        let request = SKProductsRequest::initWithProductIdentifiers(
            SKProductsRequest::alloc(),
            &ns_set,
        );
        request.setDelegate(Some(ProtocolObject::from_ref(&*mgr.delegate)));
        *mgr.delegate.ivars().active_request.lock().unwrap() = Some(request.clone());
        request.start();
    }

    match rx.await {
        Ok(result) => result,
        Err(_) => Err("Products request was cancelled".to_string()),
    }
}

pub async fn purchase(product_id: String) -> Result<IapPurchaseResult, String> {
    let mgr = manager();

    if !unsafe { SKPaymentQueue::canMakePayments() } {
        return Err("In-app purchases are not allowed on this device".to_string());
    }

    if !product_cached(mgr, &product_id) {
        let _ = fetch_products(vec![product_id.clone()]).await?;
    }
    let sk_product = lookup_cached(mgr, &product_id)
        .ok_or_else(|| format!("Product {product_id} not available from the App Store"))?;

    let (tx, rx) = oneshot::channel();
    {
        let mut pending = mgr.delegate.ivars().pending_purchase.lock().unwrap();
        if pending.is_some() {
            return Err("Another purchase is already in progress".to_string());
        }
        *pending = Some(PendingPurchase {
            product_id: product_id.clone(),
            sender: tx,
        });
    }

    unsafe {
        let payment = SKPayment::paymentWithProduct(&sk_product);
        SKPaymentQueue::defaultQueue().addPayment(&payment);
    }

    match rx.await {
        Ok(result) => result,
        Err(_) => Err("Purchase was cancelled before completion".to_string()),
    }
}

pub async fn restore() -> Result<IapRestoreResult, String> {
    let mgr = manager();
    let (tx, rx) = oneshot::channel();
    {
        let mut pending = mgr.delegate.ivars().pending_restore.lock().unwrap();
        if pending.is_some() {
            return Err("A restore is already in progress".to_string());
        }
        *pending = Some(PendingRestore {
            sender: tx,
            restored_any: false,
        });
    }

    unsafe {
        SKPaymentQueue::defaultQueue().restoreCompletedTransactions();
    }

    let restored = match rx.await {
        Ok(Ok(restored)) => restored,
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err("Restore was cancelled".to_string()),
    };

    Ok(IapRestoreResult { restored })
}

/// Eagerly install the transaction observer (called from `lib.rs` at startup
/// so we don't miss transactions delivered while the app is launching).
/// The `MainThreadMarker` parameter is unused at runtime but documents the
/// expectation that the caller is on the AppKit main thread.
pub fn install_observer_on_startup(_mtm: MainThreadMarker) {
    let _ = manager();
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

fn product_cached(mgr: &Manager, product_id: &str) -> bool {
    mgr.delegate
        .ivars()
        .cached_products
        .lock()
        .unwrap()
        .iter()
        .any(|p| {
            let id = unsafe { p.productIdentifier() };
            id.to_string() == product_id
        })
}

fn lookup_cached(mgr: &Manager, product_id: &str) -> Option<Retained<SKProduct>> {
    mgr.delegate
        .ivars()
        .cached_products
        .lock()
        .unwrap()
        .iter()
        .find(|p| {
            let id = unsafe { p.productIdentifier() };
            id.to_string() == product_id
        })
        .cloned()
}

fn format_ns_error(error: &NSError) -> String {
    let desc = error.localizedDescription();
    desc.to_string()
}

fn product_to_wire(product: &SKProduct) -> Option<IapProduct> {
    unsafe {
        let id = product.productIdentifier().to_string();
        let title = product.localizedTitle().to_string();
        let description = product.localizedDescription().to_string();
        let price = format_price(&product.price(), &product.priceLocale())?;
        Some(IapProduct {
            id,
            title,
            description,
            price,
        })
    }
}

fn format_price(amount: &NSDecimalNumber, locale: &NSLocale) -> Option<String> {
    let formatter = NSNumberFormatter::new();
    formatter.setNumberStyle(NSNumberFormatterStyle::CurrencyStyle);
    formatter.setLocale(Some(locale));
    // `NSDecimalNumber` is an `NSNumber` subclass; pass through the AsRef impl.
    let as_number: &objc2_foundation::NSNumber = amount;
    formatter.stringFromNumber(as_number).map(|s| s.to_string())
}

fn compute_expires_at(
    product_id: &str,
    txn_date: Option<&NSDate>,
    cached_products: &[Retained<SKProduct>],
) -> Option<String> {
    let product = cached_products.iter().find(|p| {
        let id = unsafe { p.productIdentifier() };
        id.to_string() == product_id
    })?;
    let period = unsafe { product.subscriptionPeriod() }?;
    let txn_date = txn_date?;
    let secs = txn_date.timeIntervalSince1970() as i64;
    let start = DateTime::<Utc>::from_timestamp(secs, 0)?;
    let units = unsafe { period.numberOfUnits() } as u32;
    let unit = unsafe { period.unit() };
    add_period(start, units, unit).map(|d| d.to_rfc3339())
}

fn add_period(start: DateTime<Utc>, units: u32, unit: SKProductPeriodUnit) -> Option<DateTime<Utc>> {
    match unit {
        SKProductPeriodUnit::Day => {
            start.checked_add_signed(chrono::Duration::days(units as i64))
        }
        SKProductPeriodUnit::Week => {
            start.checked_add_signed(chrono::Duration::weeks(units as i64))
        }
        SKProductPeriodUnit::Month => start.checked_add_months(Months::new(units)),
        SKProductPeriodUnit::Year => {
            start.checked_add_months(Months::new(units.saturating_mul(12)))
        }
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Tests — limited to logic we can exercise without a live StoreKit session.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn add_period_year_adds_twelve_months() {
        let start = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
        let end = add_period(start, 1, SKProductPeriodUnit::Year).unwrap();
        assert_eq!(end, Utc.with_ymd_and_hms(2027, 1, 1, 0, 0, 0).unwrap());
    }

    #[test]
    fn add_period_month_adds_calendar_month() {
        let start = Utc.with_ymd_and_hms(2026, 5, 18, 12, 0, 0).unwrap();
        let end = add_period(start, 3, SKProductPeriodUnit::Month).unwrap();
        assert_eq!(end, Utc.with_ymd_and_hms(2026, 8, 18, 12, 0, 0).unwrap());
    }

    #[test]
    fn add_period_week_adds_seven_days_per_unit() {
        let start = Utc.with_ymd_and_hms(2026, 5, 18, 0, 0, 0).unwrap();
        let end = add_period(start, 2, SKProductPeriodUnit::Week).unwrap();
        assert_eq!(end, Utc.with_ymd_and_hms(2026, 6, 1, 0, 0, 0).unwrap());
    }

    #[test]
    fn add_period_day_adds_n_days() {
        let start = Utc.with_ymd_and_hms(2026, 5, 18, 0, 0, 0).unwrap();
        let end = add_period(start, 5, SKProductPeriodUnit::Day).unwrap();
        assert_eq!(end, Utc.with_ymd_and_hms(2026, 5, 23, 0, 0, 0).unwrap());
    }

    #[test]
    fn add_period_unknown_unit_returns_none() {
        let start = Utc.with_ymd_and_hms(2026, 5, 18, 0, 0, 0).unwrap();
        assert!(add_period(start, 1, SKProductPeriodUnit(999)).is_none());
    }
}
