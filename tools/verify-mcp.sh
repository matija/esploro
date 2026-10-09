set -euo pipefail
cd "$(dirname "$0")/.."
for prerequisite in docker cargo npm xcrun; do
  command -v "$prerequisite" >/dev/null || { echo "Missing prerequisite: $prerequisite" >&2; exit 1; }
done
docker info >/dev/null 2>&1 || { echo 'Docker is not running. Start Docker or Colima before verification; this command does not provision a VM.' >&2; exit 1; }
docker compose version >/dev/null
project="esploro-mcp-$(uuidgen | tr '[:upper:]' '[:lower:]')"
compose=(docker compose -p "$project" -f tools/mcp/compose.yml)
cleanup() {
  result=$?
  trap - EXIT INT TERM
  if [ "$result" -ne 0 ]; then "${compose[@]}" logs --tail 80 || true; fi
  "${compose[@]}" down --volumes --remove-orphans || result=1
  remaining=$(docker ps -aq --filter "label=com.docker.compose.project=$project") || result=1
  test -z "${remaining:-}" || result=1
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
"${compose[@]}" up -d --wait --wait-timeout 180
port() { "${compose[@]}" port "$1" "$2" | awk -F: '{print $NF}'; }
export ESPLORO_TEST_POSTGRES_URL="postgres://postgres:acceptance@127.0.0.1:$(port postgres 5432)/acceptance"
export ESPLORO_TEST_MYSQL_URL="mysql://root:acceptance@127.0.0.1:$(port mysql 3306)/acceptance"
export ESPLORO_TEST_MARIADB_URL="mysql://root:acceptance@127.0.0.1:$(port mariadb 3306)/acceptance"
export ESPLORO_REQUIRE_DATABASES=1
cargo metadata --locked --format-version 1 --manifest-path Cargo.toml >/dev/null
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets --features integration-db -- -D warnings
cargo test --locked --workspace --features integration-db -- --nocapture
npm run verify
git diff --check
npm run tauri -- build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
test -x target/release/bundle/macos/Esploro.app/Contents/MacOS/esploro
printf 'MCP acceptance passed with PostgreSQL, MySQL and MariaDB. Built %s/target/release/bundle/macos/Esploro.app\n' "$PWD"
