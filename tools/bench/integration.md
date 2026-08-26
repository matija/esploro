# Running the integration-db suite locally

`src-tauri/tests/integration.rs` exercises schema introspection and
row-mutation command paths against real Postgres and MySQL servers. It is
gated behind the `integration-db` Cargo feature so a plain `cargo test`
never needs a live database, and it is **not** wired into
`.github/workflows/ci.yml` — run it locally, on demand.

## 1. Start Postgres and MySQL with `docker compose`

Create a `docker-compose.yml` (anywhere outside the repo, or as a local,
untracked file) with:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: esploro
      POSTGRES_DB: esploro_test
    ports:
      - "55432:5432"

  mysql:
    image: mysql:8
    environment:
      MYSQL_ROOT_PASSWORD: esploro
      MYSQL_DATABASE: esploro_test
    ports:
      - "53306:3306"
```

Bring both up and wait for them to accept connections:

```sh
docker compose up -d
docker compose logs -f  # watch until both report "ready for connections"
```

## 2. Export the connection URLs

The suite reads these two env vars; either may be omitted and the
corresponding driver's tests skip cleanly (`common::env_url` in
`src-tauri/tests/integration/common.rs`):

```sh
export ESPLORO_TEST_POSTGRES_URL="postgres://postgres:esploro@127.0.0.1:55432/esploro_test"
export ESPLORO_TEST_MYSQL_URL="mysql://root:esploro@127.0.0.1:53306/esploro_test"
```

## 3. Run the suite

```sh
cargo test --manifest-path src-tauri/Cargo.toml \
  --features integration-db --test integration
```

Tests create uniquely-named tables per run (`common::unique_table_name`) so
re-running against the same database is safe.

## 4. Tear down

```sh
docker compose down -v
```
