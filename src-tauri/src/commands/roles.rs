use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{AppState, DriverSession};

fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleSummary {
    pub name: String,
    pub is_superuser: bool,
    pub inherit: bool,
    pub create_role: bool,
    pub create_db: bool,
    pub can_login: bool,
    pub replication: bool,
    pub bypass_rls: bool,
    pub conn_limit: i32,
    pub valid_until: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleMembers {
    pub member_of: Vec<String>,
    pub members: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleDependent {
    pub kind: String,
    pub name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRoleRequest {
    pub name: String,
    pub is_superuser: Option<bool>,
    pub inherit: Option<bool>,
    pub create_role: Option<bool>,
    pub create_db: Option<bool>,
    pub can_login: Option<bool>,
    pub replication: Option<bool>,
    pub bypass_rls: Option<bool>,
    pub conn_limit: Option<i32>,
    pub valid_until: Option<String>,
    pub password: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlterRoleRequest {
    pub is_superuser: Option<bool>,
    pub inherit: Option<bool>,
    pub create_role: Option<bool>,
    pub create_db: Option<bool>,
    pub can_login: Option<bool>,
    pub replication: Option<bool>,
    pub bypass_rls: Option<bool>,
    pub conn_limit: Option<i32>,
    /// ISO date string to set, empty string to clear (sets to 'infinity')
    pub valid_until: Option<String>,
    /// Set-only. None = don't change. Some("") = set to NULL. Some(pw) = set new password.
    pub password: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MembershipOp {
    pub op: String,     // "grant" or "revoke"
    pub role: String,
    pub member: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MembershipResult {
    pub op: String,
    pub role: String,
    pub member: String,
    pub error: Option<String>,
}

/// Build the WITH clause options for CREATE/ALTER ROLE.
/// Returns (options_string, password_param) where password_param is Some(pw) for PASSWORD $1.
fn build_role_options(
    is_superuser: Option<bool>,
    inherit: Option<bool>,
    create_role: Option<bool>,
    create_db: Option<bool>,
    can_login: Option<bool>,
    replication: Option<bool>,
    bypass_rls: Option<bool>,
    conn_limit: Option<i32>,
    valid_until: Option<&str>,
    password: Option<&str>,
) -> (String, Option<String>) {
    let mut parts: Vec<String> = Vec::new();

    if let Some(v) = is_superuser {
        parts.push(if v { "SUPERUSER" } else { "NOSUPERUSER" }.into());
    }
    if let Some(v) = inherit {
        parts.push(if v { "INHERIT" } else { "NOINHERIT" }.into());
    }
    if let Some(v) = create_role {
        parts.push(if v { "CREATEROLE" } else { "NOCREATEROLE" }.into());
    }
    if let Some(v) = create_db {
        parts.push(if v { "CREATEDB" } else { "NOCREATEDB" }.into());
    }
    if let Some(v) = can_login {
        parts.push(if v { "LOGIN" } else { "NOLOGIN" }.into());
    }
    if let Some(v) = replication {
        parts.push(if v { "REPLICATION" } else { "NOREPLICATION" }.into());
    }
    if let Some(v) = bypass_rls {
        parts.push(if v { "BYPASSRLS" } else { "NOBYPASSRLS" }.into());
    }
    if let Some(v) = conn_limit {
        parts.push(format!("CONNECTION LIMIT {}", v));
    }
    if let Some(v) = valid_until {
        if v.is_empty() {
            parts.push("VALID UNTIL 'infinity'".into());
        } else {
            // Strip single quotes to prevent breaking out of the literal.
            let safe = v.replace('\'', "");
            parts.push(format!("VALID UNTIL '{}'", safe));
        }
    }

    let pass_param = match password {
        None => None,
        Some("") => {
            parts.push("PASSWORD NULL".into());
            None
        }
        Some(pw) => {
            parts.push("PASSWORD $1".into());
            Some(pw.to_string())
        }
    };

    (parts.join(" "), pass_param)
}

// ─── list_roles ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_roles(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<RoleSummary>, String> {
    let sessions = state.sessions.lock().await;
    let info = sessions
        .get(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;

    match &info.driver {
        DriverSession::Postgres(pool) => {
            let client = pool.get().await.map_err(|e| e.to_string())?;
            let rows = client
                .query(
                    "SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, \
                            rolcanlogin, rolreplication, rolbypassrls, rolconnlimit, \
                            rolvaliduntil::text \
                     FROM pg_roles \
                     WHERE rolname NOT LIKE 'pg_%' \
                     ORDER BY rolname",
                    &[],
                )
                .await
                .map_err(|e| e.to_string())?;

            Ok(rows
                .iter()
                .map(|r| RoleSummary {
                    name: r.get(0),
                    is_superuser: r.get(1),
                    inherit: r.get(2),
                    create_role: r.get(3),
                    create_db: r.get(4),
                    can_login: r.get(5),
                    replication: r.get(6),
                    bypass_rls: r.get(7),
                    conn_limit: r.get(8),
                    valid_until: r.get(9),
                })
                .collect())
        }
        DriverSession::Mysql(_) => Err("Roles are not supported for MySQL connections".to_string()),
    }
}

// ─── list_role_members ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_role_members(
    session_id: String,
    role_name: String,
    state: State<'_, AppState>,
) -> Result<RoleMembers, String> {
    let sessions = state.sessions.lock().await;
    let info = sessions
        .get(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;

    match &info.driver {
        DriverSession::Postgres(pool) => {
            let client = pool.get().await.map_err(|e| e.to_string())?;

            let members_rows = client
                .query(
                    "SELECT m.rolname \
                     FROM pg_roles r \
                     JOIN pg_auth_members am ON am.roleid = r.oid \
                     JOIN pg_roles m ON m.oid = am.member \
                     WHERE r.rolname = $1 \
                     ORDER BY m.rolname",
                    &[&role_name],
                )
                .await
                .map_err(|e| e.to_string())?;

            let member_of_rows = client
                .query(
                    "SELECT r.rolname \
                     FROM pg_roles m \
                     JOIN pg_auth_members am ON am.member = m.oid \
                     JOIN pg_roles r ON r.oid = am.roleid \
                     WHERE m.rolname = $1 \
                     ORDER BY r.rolname",
                    &[&role_name],
                )
                .await
                .map_err(|e| e.to_string())?;

            Ok(RoleMembers {
                members: members_rows.iter().map(|r| r.get(0)).collect(),
                member_of: member_of_rows.iter().map(|r| r.get(0)).collect(),
            })
        }
        DriverSession::Mysql(_) => Err("Roles are not supported for MySQL connections".to_string()),
    }
}

// ─── get_role_dependents ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_role_dependents(
    session_id: String,
    role_name: String,
    state: State<'_, AppState>,
) -> Result<Vec<RoleDependent>, String> {
    let sessions = state.sessions.lock().await;
    let info = sessions
        .get(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;

    match &info.driver {
        DriverSession::Postgres(pool) => {
            let client = pool.get().await.map_err(|e| e.to_string())?;
            let rows = client
                .query(
                    "SELECT kind, name FROM ( \
                       SELECT \
                         CASE c.relkind \
                           WHEN 'r' THEN 'table' \
                           WHEN 'v' THEN 'view' \
                           WHEN 'S' THEN 'sequence' \
                           WHEN 'm' THEN 'view' \
                           ELSE 'relation' \
                         END AS kind, \
                         n.nspname || '.' || c.relname AS name \
                       FROM pg_class c \
                       JOIN pg_namespace n ON n.oid = c.relnamespace \
                       WHERE c.relowner = (SELECT oid FROM pg_roles WHERE rolname = $1) \
                         AND n.nspname NOT IN ('pg_catalog','information_schema') \
                       UNION ALL \
                       SELECT 'schema', nspname \
                       FROM pg_namespace \
                       WHERE nspowner = (SELECT oid FROM pg_roles WHERE rolname = $1) \
                       UNION ALL \
                       SELECT 'function', n.nspname || '.' || p.proname \
                       FROM pg_proc p \
                       JOIN pg_namespace n ON n.oid = p.pronamespace \
                       WHERE p.proowner = (SELECT oid FROM pg_roles WHERE rolname = $1) \
                         AND n.nspname NOT IN ('pg_catalog','information_schema') \
                     ) t \
                     ORDER BY kind, name \
                     LIMIT 50",
                    &[&role_name],
                )
                .await
                .map_err(|e| e.to_string())?;

            Ok(rows
                .iter()
                .map(|r| RoleDependent {
                    kind: r.get(0),
                    name: r.get(1),
                })
                .collect())
        }
        DriverSession::Mysql(_) => Err("Roles are not supported for MySQL connections".to_string()),
    }
}

// ─── create_role ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn create_role(
    session_id: String,
    request: CreateRoleRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let sessions = state.sessions.lock().await;
    let info = sessions
        .get(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;

    match &info.driver {
        DriverSession::Postgres(pool) => {
            let client = pool.get().await.map_err(|e| e.to_string())?;

            let (options, pass_param) = build_role_options(
                request.is_superuser,
                request.inherit,
                request.create_role,
                request.create_db,
                request.can_login,
                request.replication,
                request.bypass_rls,
                request.conn_limit,
                request.valid_until.as_deref(),
                request.password.as_deref(),
            );

            let ident = quote_ident(&request.name);
            let sql = if options.is_empty() {
                format!("CREATE ROLE {}", ident)
            } else {
                format!("CREATE ROLE {} WITH {}", ident, options)
            };

            if let Some(pw) = pass_param {
                client.execute(&sql, &[&pw]).await.map_err(|e| e.to_string())?;
            } else {
                client.execute(&sql, &[]).await.map_err(|e| e.to_string())?;
            }

            Ok(())
        }
        DriverSession::Mysql(_) => Err("Roles are not supported for MySQL connections".to_string()),
    }
}

// ─── alter_role ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn alter_role(
    session_id: String,
    role_name: String,
    request: AlterRoleRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let sessions = state.sessions.lock().await;
    let info = sessions
        .get(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;

    match &info.driver {
        DriverSession::Postgres(pool) => {
            let client = pool.get().await.map_err(|e| e.to_string())?;

            let (options, pass_param) = build_role_options(
                request.is_superuser,
                request.inherit,
                request.create_role,
                request.create_db,
                request.can_login,
                request.replication,
                request.bypass_rls,
                request.conn_limit,
                request.valid_until.as_deref(),
                request.password.as_deref(),
            );

            if options.is_empty() {
                return Ok(());
            }

            let ident = quote_ident(&role_name);
            let sql = format!("ALTER ROLE {} WITH {}", ident, options);

            if let Some(pw) = pass_param {
                client.execute(&sql, &[&pw]).await.map_err(|e| e.to_string())?;
            } else {
                client.execute(&sql, &[]).await.map_err(|e| e.to_string())?;
            }

            Ok(())
        }
        DriverSession::Mysql(_) => Err("Roles are not supported for MySQL connections".to_string()),
    }
}

// ─── drop_role ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn drop_role(
    session_id: String,
    role_name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let sessions = state.sessions.lock().await;
    let info = sessions
        .get(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;

    match &info.driver {
        DriverSession::Postgres(pool) => {
            let client = pool.get().await.map_err(|e| e.to_string())?;
            let sql = format!("DROP ROLE {}", quote_ident(&role_name));
            client.execute(&sql, &[]).await.map_err(|e| e.to_string())?;
            Ok(())
        }
        DriverSession::Mysql(_) => Err("Roles are not supported for MySQL connections".to_string()),
    }
}

// ─── manage_role_membership ───────────────────────────────────────────────────

#[tauri::command]
pub async fn manage_role_membership(
    session_id: String,
    ops: Vec<MembershipOp>,
    state: State<'_, AppState>,
) -> Result<Vec<MembershipResult>, String> {
    let sessions = state.sessions.lock().await;
    let info = sessions
        .get(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;

    match &info.driver {
        DriverSession::Postgres(pool) => {
            let client = pool.get().await.map_err(|e| e.to_string())?;
            let mut results = Vec::with_capacity(ops.len());

            for op in ops {
                let sql = match op.op.as_str() {
                    "grant" => format!(
                        "GRANT {} TO {}",
                        quote_ident(&op.role),
                        quote_ident(&op.member)
                    ),
                    "revoke" => format!(
                        "REVOKE {} FROM {}",
                        quote_ident(&op.role),
                        quote_ident(&op.member)
                    ),
                    other => {
                        results.push(MembershipResult {
                            op: op.op.clone(),
                            role: op.role.clone(),
                            member: op.member.clone(),
                            error: Some(format!("Unknown op: {}", other)),
                        });
                        continue;
                    }
                };

                let error = client.execute(&sql, &[]).await.err().map(|e| e.to_string());
                results.push(MembershipResult {
                    op: op.op,
                    role: op.role,
                    member: op.member,
                    error,
                });
            }

            Ok(results)
        }
        DriverSession::Mysql(_) => Err("Roles are not supported for MySQL connections".to_string()),
    }
}
