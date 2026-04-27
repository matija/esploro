# Phase 02 — Connection Management

**Goal:** Users can create, edit, delete, and test Postgres connection profiles. Passwords live in macOS Keychain. Connecting opens a live session that later phases use.

**Done when:**
- Connection profile CRUD works end-to-end.
- Passwords retrieved from Keychain on connect (never stored in JSON).
- Test Connection button reports success/failure with latency.
- Quick-connect from a `postgres://` URL parses and pre-fills the form.
- Local Unix socket path supported as an alternative to host/port.
- Active connections shown with a green dot in the sidebar.

---

## 2.1 Data model

### ConnectionProfile (stored in `$APP_DATA_DIR/connections.json`)

```rust
#[derive(Serialize, Deserialize, Clone)]
pub struct ConnectionProfile {
    pub id: String,          // uuid v4
    pub display_name: String,
    pub color: Option<String>, // hex, for sidebar dot
    pub folder: Option<String>,
    pub host: Option<String>,  // None = use socket_path
    pub port: u16,             // default 5432
    pub socket_path: Option<String>,
    pub database: String,
    pub username: String,
    // password NOT stored here — lives in Keychain keyed by id
    pub ssl_mode: SslMode,
    pub created_at: String,    // ISO 8601
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub enum SslMode { Disable, Prefer, Require, VerifyFull }
```

Keychain key: `esploro:connection:{id}` → password string.

### AppState (Rust)

```rust
pub struct AppState {
    pub sessions: Mutex<HashMap<String, Arc<deadpool_postgres::Pool>>>,
    // session_id -> pool; one pool per active connection
}
```

---

## 2.2 Tauri commands

File: `src-tauri/src/commands/connections.rs`

```rust
#[tauri::command]
pub async fn list_connections(state: State<'_, AppState>) -> Result<Vec<ConnectionProfile>, String>

#[tauri::command]
pub async fn create_connection(
    profile: ConnectionProfile,
    password: String,
    state: State<'_, AppState>,
) -> Result<String, String>  // returns new id

#[tauri::command]
pub async fn update_connection(
    id: String,
    profile: ConnectionProfile,
    password: Option<String>,  // None = keep existing
    state: State<'_, AppState>,
) -> Result<(), String>

#[tauri::command]
pub async fn delete_connection(id: String, state: State<'_, AppState>) -> Result<(), String>
// also removes Keychain entry; disconnects session if active

#[tauri::command]
pub async fn test_connection(
    profile: ConnectionProfile,
    password: String,
) -> Result<u64, String>  // Ok = round-trip ms

#[tauri::command]
pub async fn connect(
    id: String,
    state: State<'_, AppState>,
) -> Result<String, String>  // Ok = session_id (uuid)

#[tauri::command]
pub async fn disconnect(session_id: String, state: State<'_, AppState>) -> Result<(), String>
```

### Connection pool construction

```rust
fn build_pool(profile: &ConnectionProfile, password: &str)
    -> Result<deadpool_postgres::Pool, String>
{
    let mut cfg = deadpool_postgres::Config::new();
    if let Some(socket) = &profile.socket_path {
        cfg.host = Some(socket.clone());
    } else {
        cfg.host = Some(profile.host.clone().unwrap_or("localhost".into()));
    }
    cfg.port = Some(profile.port);
    cfg.dbname = Some(profile.database.clone());
    cfg.user = Some(profile.username.clone());
    cfg.password = Some(password.to_string());
    // ssl config omitted for brevity — use native-tls feature
    cfg.create_pool(Some(deadpool_postgres::Runtime::Tokio1), NoTls)
       .map_err(|e| e.to_string())
}
```

`test_connection` creates a pool, gets one client, runs `SELECT 1`, measures elapsed, drops pool.

---

## 2.3 Cargo additions

```toml
tokio-postgres = { version = "0.7", features = ["with-uuid-1"] }
deadpool-postgres = { version = "0.12", features = ["rt_tokio_1"] }
keyring = "2"
```

---

## 2.4 Frontend — Connection form

`src/features/connections/ConnectionForm.tsx`

Fields:
- Display Name (text)
- Color picker (6 preset swatches)
- Folder (text, optional)
- Connection type toggle: **Host/Port** | **Unix Socket**
  - Host/Port: Host (text), Port (number, default 5432)
  - Unix Socket: Socket Path (text, e.g. `/var/run/postgresql`)
- Database (text)
- Username (text)
- Password (password input, never stored locally after submission)
- SSL Mode (select: Disable / Prefer / Require / Verify Full)
- [Advanced] collapsible section for future options (cert paths, etc.)
- "Parse from URL" button: parses `postgres://user:pass@host:port/db` and fills fields

Validation (client-side before invoke):
- Display name required.
- Either host or socket path required.
- Database and username required.

`src/features/connections/ConnectionList.tsx` — sidebar section rendering profiles. Active sessions shown with green filled dot. Inactive with colored border dot.

---

## 2.5 Quick-connect URL parsing

```typescript
function parsePostgresUrl(url: string): Partial<ConnectionFormValues> {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: parseInt(u.port) || 5432,
    database: u.pathname.slice(1),
    username: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  };
}
```

Accessible via a "From URL..." button at the top of the form and via `⌘K` → "Connect from URL".

---

## 2.6 Zustand slice

```typescript
interface ConnectionsSlice {
  profiles: ConnectionSummary[];     // loaded at startup
  activeSessions: Record<string, string>; // connectionId -> sessionId
  loadProfiles: () => Promise<void>;
  connect: (id: string) => Promise<void>;
  disconnect: (sessionId: string) => Promise<void>;
}
```

---

## 2.7 Command palette integration

Register commands in `CommandPalette`:
- "New Connection" → opens ConnectionForm sheet.
- Each profile → "Connect to {name}" action.

---

## Acceptance checklist

- [ ] Create a connection profile; verify `connections.json` written without password field.
- [ ] Verify password stored in Keychain (`security find-generic-password -a esploro`).
- [ ] Test Connection shows latency on success, error message on failure.
- [ ] Edit connection; change password updates Keychain only.
- [ ] Delete connection removes JSON entry and Keychain entry.
- [ ] Connect → session_id returned; disconnect → session removed from AppState.
- [ ] Unix socket connection works against a local `pg` cluster.
- [ ] Paste `postgres://` URL and verify fields populate correctly.
- [ ] Sidebar shows green dot on active connections.
