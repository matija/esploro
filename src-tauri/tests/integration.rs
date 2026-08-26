//! End-to-end integration suite that exercises schema introspection and
//! row-mutation command paths against real Postgres/MySQL servers.
//!
//! Gated behind the `integration-db` feature so a plain `cargo test` never
//! needs a live database. Run with:
//!
//!   ESPLORO_TEST_POSTGRES_URL=postgres://user:pass@localhost/db \
//!   ESPLORO_TEST_MYSQL_URL=mysql://user:pass@localhost/db \
//!   cargo test --features integration-db --test integration
//!
//! Either URL may be omitted; the corresponding driver's tests skip cleanly.
#![cfg(feature = "integration-db")]

mod integration {
    mod common;
    mod mysql;
    mod postgres;
}
