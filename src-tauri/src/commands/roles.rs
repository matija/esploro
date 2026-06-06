use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{AppError, AppState, DriverSession};

mod sql_builders;

use self::sql_builders::{
    build_alter_role_sql, build_create_role_sql, build_drop_role_sql, build_membership_sql,
    build_role_privilege_sql, build_schema_privilege_sql, build_table_privilege_sql,
    format_unknown_role_privilege_sql, format_unknown_schema_privilege_sql,
    format_unknown_table_privilege_sql, RoleOptions,
};

#[derive(Serialize, specta::Type)]
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

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RoleMembers {
    pub member_of: Vec<String>,
    pub members: Vec<String>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RoleDependent {
    pub kind: String,
    pub name: String,
}

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CreateRoleRequest {
    pub name: String,
    #[serde(default)]
    pub is_superuser: Option<bool>,
    #[serde(default)]
    pub inherit: Option<bool>,
    #[serde(default)]
    pub create_role: Option<bool>,
    #[serde(default)]
    pub create_db: Option<bool>,
    #[serde(default)]
    pub can_login: Option<bool>,
    #[serde(default)]
    pub replication: Option<bool>,
    #[serde(default)]
    pub bypass_rls: Option<bool>,
    #[serde(default)]
    pub conn_limit: Option<i32>,
    #[serde(default)]
    pub valid_until: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
}

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AlterRoleRequest {
    #[serde(default)]
    pub is_superuser: Option<bool>,
    #[serde(default)]
    pub inherit: Option<bool>,
    #[serde(default)]
    pub create_role: Option<bool>,
    #[serde(default)]
    pub create_db: Option<bool>,
    #[serde(default)]
    pub can_login: Option<bool>,
    #[serde(default)]
    pub replication: Option<bool>,
    #[serde(default)]
    pub bypass_rls: Option<bool>,
    #[serde(default)]
    pub conn_limit: Option<i32>,
    /// ISO date string to set, empty string to clear (sets to 'infinity')
    #[serde(default)]
    pub valid_until: Option<String>,
    /// Set-only. None = don't change. Some("") = set to NULL. Some(pw) = set new password.
    #[serde(default)]
    pub password: Option<String>,
}

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MembershipOp {
    pub op: String, // "grant" or "revoke"
    pub role: String,
    pub member: String,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MembershipResult {
    pub op: String,
    pub role: String,
    pub member: String,
    pub error: Option<String>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RoleTableGrant {
    pub schema: String,
    pub table: String,
    pub privileges: Vec<String>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RoleSchemaGrant {
    pub schema: String,
    pub privileges: Vec<String>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RolePrivileges {
    pub table_grants: Vec<RoleTableGrant>,
    pub schema_grants: Vec<RoleSchemaGrant>,
}

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PrivilegeOp {
    pub op: String,          // "grant" or "revoke"
    pub object_type: String, // "table" or "schema"
    pub schema: String,
    pub name: String, // table name for tables; same as schema for schema grants
    pub privilege: String,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PrivilegeResult {
    pub sql: String,
    pub error: Option<String>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TableGrantee {
    pub grantee: String,
    pub privileges: Vec<String>,
}

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TablePrivilegeOp {
    pub op: String, // "grant" or "revoke"
    pub grantee: String,
    pub privilege: String,
}

// ─── list_roles ───────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn list_roles(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<RoleSummary>, AppError> {
    let sessions = state.sessions.lock().await;
    let info = sessions.get(&session_id).ok_or(AppError::SessionNotFound)?;

    match &info.driver {
        DriverSession::Postgres(pool) => {
            let client = pool.get().await?;
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
                .await?;

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
        DriverSession::Mysql(_) => Err("Roles are not supported for MySQL connections".into()),
    }
}

// ─── list_role_members ────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn list_role_members(
    session_id: String,
    role_name: String,
    state: State<'_, AppState>,
) -> Result<RoleMembers, AppError> {
    let sessions = state.sessions.lock().await;
    let info = sessions.get(&session_id).ok_or(AppError::SessionNotFound)?;

    match &info.driver {
        DriverSession::Postgres(pool) => {
            let client = pool.get().await?;

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
                .await?;

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
                .await?;

            Ok(RoleMembers {
                members: members_rows.iter().map(|r| r.get(0)).collect(),
                member_of: member_of_rows.iter().map(|r| r.get(0)).collect(),
            })
        }
        DriverSession::Mysql(_) => Err("Roles are not supported for MySQL connections".into()),
    }
}

// ─── get_role_dependents ──────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn get_role_dependents(
    session_id: String,
    role_name: String,
    state: State<'_, AppState>,
) -> Result<Vec<RoleDependent>, AppError> {
    let sessions = state.sessions.lock().await;
    let info = sessions.get(&session_id).ok_or(AppError::SessionNotFound)?;

    match &info.driver {
        DriverSession::Postgres(pool) => {
            let client = pool.get().await?;
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
                .await?;

            Ok(rows
                .iter()
                .map(|r| RoleDependent {
                    kind: r.get(0),
                    name: r.get(1),
                })
                .collect())
        }
        DriverSession::Mysql(_) => Err("Roles are not supported for MySQL connections".into()),
    }
}

// ─── create_role ──────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn create_role(
    session_id: String,
    request: CreateRoleRequest,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let sessions = state.sessions.lock().await;
    let info = sessions.get(&session_id).ok_or(AppError::SessionNotFound)?;

    match &info.driver {
        DriverSession::Postgres(pool) => {
            let client = pool.get().await?;

            let (sql, pass_param) = build_create_role_sql(
                &request.name,
                RoleOptions {
                    is_superuser: request.is_superuser,
                    inherit: request.inherit,
                    create_role: request.create_role,
                    create_db: request.create_db,
                    can_login: request.can_login,
                    replication: request.replication,
                    bypass_rls: request.bypass_rls,
                    conn_limit: request.conn_limit,
                    valid_until: request.valid_until.as_deref(),
                    password: request.password.as_deref(),
                },
            );

            if let Some(pw) = pass_param {
                client.execute(&sql, &[&pw]).await?;
            } else {
                client.execute(&sql, &[]).await?;
            }

            Ok(())
        }
        DriverSession::Mysql(_) => Err("Roles are not supported for MySQL connections".into()),
    }
}

// ─── alter_role ───────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn alter_role(
    session_id: String,
    role_name: String,
    request: AlterRoleRequest,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let sessions = state.sessions.lock().await;
    let info = sessions.get(&session_id).ok_or(AppError::SessionNotFound)?;

    match &info.driver {
        DriverSession::Postgres(pool) => {
            let client = pool.get().await?;

            let Some((sql, pass_param)) = build_alter_role_sql(
                &role_name,
                RoleOptions {
                    is_superuser: request.is_superuser,
                    inherit: request.inherit,
                    create_role: request.create_role,
                    create_db: request.create_db,
                    can_login: request.can_login,
                    replication: request.replication,
                    bypass_rls: request.bypass_rls,
                    conn_limit: request.conn_limit,
                    valid_until: request.valid_until.as_deref(),
                    password: request.password.as_deref(),
                },
            ) else {
                return Ok(());
            };

            if let Some(pw) = pass_param {
                client.execute(&sql, &[&pw]).await?;
            } else {
                client.execute(&sql, &[]).await?;
            }

            Ok(())
        }
        DriverSession::Mysql(_) => Err("Roles are not supported for MySQL connections".into()),
    }
}

// ─── drop_role ────────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn drop_role(
    session_id: String,
    role_name: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let sessions = state.sessions.lock().await;
    let info = sessions.get(&session_id).ok_or(AppError::SessionNotFound)?;

    match &info.driver {
        DriverSession::Postgres(pool) => {
            let client = pool.get().await?;
            let sql = build_drop_role_sql(&role_name);
            client.execute(&sql, &[]).await?;
            Ok(())
        }
        DriverSession::Mysql(_) => Err("Roles are not supported for MySQL connections".into()),
    }
}

// ─── list_role_privileges ─────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn list_role_privileges(
    session_id: String,
    role_name: String,
    state: State<'_, AppState>,
) -> Result<RolePrivileges, AppError> {
    use std::collections::BTreeMap;

    let sessions = state.sessions.lock().await;
    let info = sessions.get(&session_id).ok_or(AppError::SessionNotFound)?;

    match &info.driver {
        DriverSession::Postgres(pool) => {
            let client = pool.get().await?;

            // Table grants via information_schema
            let table_rows = client
                .query(
                    "SELECT table_schema, table_name, privilege_type \
                     FROM information_schema.role_table_grants \
                     WHERE grantee = $1 \
                       AND table_schema NOT IN ('pg_catalog', 'information_schema') \
                     ORDER BY table_schema, table_name, privilege_type",
                    &[&role_name],
                )
                .await?;

            let mut table_map: BTreeMap<(String, String), Vec<String>> = BTreeMap::new();
            for row in &table_rows {
                let schema: String = row.get(0);
                let table: String = row.get(1);
                let priv_type: String = row.get(2);
                table_map
                    .entry((schema, table))
                    .or_default()
                    .push(priv_type);
            }
            let table_grants = table_map
                .into_iter()
                .map(|((schema, table), privileges)| RoleTableGrant {
                    schema,
                    table,
                    privileges,
                })
                .collect();

            // Schema grants via pg_namespace ACL
            let schema_rows = client
                .query(
                    "SELECT n.nspname, a.privilege_type \
                     FROM pg_namespace n \
                     JOIN LATERAL aclexplode(COALESCE(n.nspacl, '{}')) a ON true \
                     WHERE a.grantee = (SELECT oid FROM pg_roles WHERE rolname = $1) \
                       AND a.privilege_type IN ('USAGE', 'CREATE') \
                       AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') \
                       AND n.nspname NOT LIKE 'pg_temp_%' \
                       AND n.nspname NOT LIKE 'pg_toast_temp_%' \
                     ORDER BY n.nspname, a.privilege_type",
                    &[&role_name],
                )
                .await?;

            let mut schema_map: BTreeMap<String, Vec<String>> = BTreeMap::new();
            for row in &schema_rows {
                let schema: String = row.get(0);
                let priv_type: String = row.get(1);
                schema_map.entry(schema).or_default().push(priv_type);
            }
            let schema_grants = schema_map
                .into_iter()
                .map(|(schema, privileges)| RoleSchemaGrant { schema, privileges })
                .collect();

            Ok(RolePrivileges {
                table_grants,
                schema_grants,
            })
        }
        DriverSession::Mysql(_) => Err("Roles are not supported for MySQL connections".into()),
    }
}

// ─── manage_role_privileges ───────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn manage_role_privileges(
    session_id: String,
    role_name: String,
    ops: Vec<PrivilegeOp>,
    state: State<'_, AppState>,
) -> Result<Vec<PrivilegeResult>, AppError> {
    let sessions = state.sessions.lock().await;
    let info = sessions.get(&session_id).ok_or(AppError::SessionNotFound)?;

    match &info.driver {
        DriverSession::Postgres(pool) => {
            let client = pool.get().await?;
            let mut results = Vec::with_capacity(ops.len());

            for op in ops {
                let sql = match build_role_privilege_sql(
                    &op.op,
                    &op.object_type,
                    &op.schema,
                    &op.name,
                    &op.privilege,
                    &role_name,
                ) {
                    Ok(sql) => sql,
                    Err(error) => {
                        results.push(PrivilegeResult {
                            sql: format_unknown_role_privilege_sql(
                                &op.op,
                                &op.schema,
                                &op.name,
                                &op.privilege,
                            ),
                            error: Some(error),
                        });
                        continue;
                    }
                };

                let error = client.execute(&sql, &[]).await.err().map(|e| e.to_string());
                results.push(PrivilegeResult { sql, error });
            }

            Ok(results)
        }
        DriverSession::Mysql(_) => Err("Roles are not supported for MySQL connections".into()),
    }
}

// ─── manage_role_membership ───────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn manage_role_membership(
    session_id: String,
    ops: Vec<MembershipOp>,
    state: State<'_, AppState>,
) -> Result<Vec<MembershipResult>, AppError> {
    let sessions = state.sessions.lock().await;
    let info = sessions.get(&session_id).ok_or(AppError::SessionNotFound)?;

    match &info.driver {
        DriverSession::Postgres(pool) => {
            let client = pool.get().await?;
            let mut results = Vec::with_capacity(ops.len());

            for op in ops {
                let sql = match build_membership_sql(&op.op, &op.role, &op.member) {
                    Ok(sql) => sql,
                    Err(error) => {
                        results.push(MembershipResult {
                            op: op.op.clone(),
                            role: op.role.clone(),
                            member: op.member.clone(),
                            error: Some(error),
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
        DriverSession::Mysql(_) => Err("Roles are not supported for MySQL connections".into()),
    }
}

// ─── list_table_privileges ────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn list_table_privileges(
    session_id: String,
    schema: String,
    table: String,
    state: State<'_, AppState>,
) -> Result<Vec<TableGrantee>, AppError> {
    use std::collections::BTreeMap;

    let sessions = state.sessions.lock().await;
    let info = sessions.get(&session_id).ok_or(AppError::SessionNotFound)?;

    match &info.driver {
        DriverSession::Postgres(pool) => {
            let client = pool.get().await?;
            let rows = client
                .query(
                    "SELECT grantee, privilege_type \
                     FROM information_schema.role_table_grants \
                     WHERE table_schema = $1 \
                       AND table_name = $2 \
                       AND grantee NOT IN ('PUBLIC') \
                     ORDER BY grantee, privilege_type",
                    &[&schema, &table],
                )
                .await?;

            let mut map: BTreeMap<String, Vec<String>> = BTreeMap::new();
            for row in &rows {
                let grantee: String = row.get(0);
                let priv_type: String = row.get(1);
                map.entry(grantee).or_default().push(priv_type);
            }

            Ok(map
                .into_iter()
                .map(|(grantee, privileges)| TableGrantee {
                    grantee,
                    privileges,
                })
                .collect())
        }
        DriverSession::Mysql(_) => Err("Privileges are not supported for MySQL connections".into()),
    }
}

// ─── manage_table_privileges ──────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn manage_table_privileges(
    session_id: String,
    schema: String,
    table: String,
    ops: Vec<TablePrivilegeOp>,
    state: State<'_, AppState>,
) -> Result<Vec<PrivilegeResult>, AppError> {
    let sessions = state.sessions.lock().await;
    let info = sessions.get(&session_id).ok_or(AppError::SessionNotFound)?;

    match &info.driver {
        DriverSession::Postgres(pool) => {
            let client = pool.get().await?;
            let mut results = Vec::with_capacity(ops.len());

            for op in ops {
                let sql = match build_table_privilege_sql(
                    &op.op,
                    &schema,
                    &table,
                    &op.privilege,
                    &op.grantee,
                ) {
                    Ok(sql) => sql,
                    Err(error) => {
                        results.push(PrivilegeResult {
                            sql: format_unknown_table_privilege_sql(
                                &op.op,
                                &schema,
                                &table,
                                &op.privilege,
                                &op.grantee,
                            ),
                            error: Some(error),
                        });
                        continue;
                    }
                };
                let error = client.execute(&sql, &[]).await.err().map(|e| e.to_string());
                results.push(PrivilegeResult { sql, error });
            }

            Ok(results)
        }
        DriverSession::Mysql(_) => Err("Privileges are not supported for MySQL connections".into()),
    }
}

// ─── list_schema_privileges ───────────────────────────────────────────────────

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SchemaGrantee {
    pub grantee: String,
    pub privileges: Vec<String>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SchemaInfo {
    pub owner: String,
    pub grantees: Vec<SchemaGrantee>,
}

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SchemaPrivilegeOp {
    pub op: String, // "grant" or "revoke"
    pub grantee: String,
    pub privilege: String,
}

#[tauri::command]
#[specta::specta]
pub async fn list_schema_privileges(
    session_id: String,
    schema: String,
    state: State<'_, AppState>,
) -> Result<SchemaInfo, AppError> {
    use std::collections::BTreeMap;

    let sessions = state.sessions.lock().await;
    let info = sessions.get(&session_id).ok_or(AppError::SessionNotFound)?;

    match &info.driver {
        DriverSession::Postgres(pool) => {
            let client = pool.get().await?;

            let owner_row = client
                .query_one(
                    "SELECT r.rolname \
                     FROM pg_namespace n \
                     JOIN pg_roles r ON r.oid = n.nspowner \
                     WHERE n.nspname = $1",
                    &[&schema],
                )
                .await?;
            let owner: String = owner_row.get(0);

            let rows = client
                .query(
                    "SELECT r.rolname, ae.privilege_type \
                     FROM pg_namespace n, \
                          LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) AS ae \
                     JOIN pg_roles r ON r.oid = ae.grantee \
                     WHERE n.nspname = $1 \
                       AND ae.privilege_type IN ('USAGE', 'CREATE') \
                       AND r.rolname NOT LIKE 'pg_%' \
                     ORDER BY r.rolname, ae.privilege_type",
                    &[&schema],
                )
                .await
                ?;

            let mut map: BTreeMap<String, Vec<String>> = BTreeMap::new();
            for row in &rows {
                let grantee: String = row.get(0);
                let priv_type: String = row.get(1);
                map.entry(grantee).or_default().push(priv_type);
            }

            let grantees = map
                .into_iter()
                .map(|(grantee, privileges)| SchemaGrantee {
                    grantee,
                    privileges,
                })
                .collect();

            Ok(SchemaInfo { owner, grantees })
        }
        DriverSession::Mysql(_) => {
            Err("Schema privileges are not supported for MySQL connections".into())
        }
    }
}

// ─── manage_schema_privileges ─────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn manage_schema_privileges(
    session_id: String,
    schema: String,
    ops: Vec<SchemaPrivilegeOp>,
    state: State<'_, AppState>,
) -> Result<Vec<PrivilegeResult>, AppError> {
    let sessions = state.sessions.lock().await;
    let info = sessions.get(&session_id).ok_or(AppError::SessionNotFound)?;

    match &info.driver {
        DriverSession::Postgres(pool) => {
            let client = pool.get().await?;
            let mut results = Vec::with_capacity(ops.len());

            for op in ops {
                let sql =
                    match build_schema_privilege_sql(&op.op, &schema, &op.privilege, &op.grantee) {
                        Ok(sql) => sql,
                        Err(error) => {
                            results.push(PrivilegeResult {
                                sql: format_unknown_schema_privilege_sql(
                                    &op.op,
                                    &schema,
                                    &op.privilege,
                                    &op.grantee,
                                ),
                                error: Some(error),
                            });
                            continue;
                        }
                    };
                let error = client.execute(&sql, &[]).await.err().map(|e| e.to_string());
                results.push(PrivilegeResult { sql, error });
            }

            Ok(results)
        }
        DriverSession::Mysql(_) => {
            Err("Schema privileges are not supported for MySQL connections".into())
        }
    }
}
