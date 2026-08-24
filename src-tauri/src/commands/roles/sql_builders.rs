pub(super) struct RoleOptions<'a> {
    pub is_superuser: Option<bool>,
    pub inherit: Option<bool>,
    pub create_role: Option<bool>,
    pub create_db: Option<bool>,
    pub can_login: Option<bool>,
    pub replication: Option<bool>,
    pub bypass_rls: Option<bool>,
    pub conn_limit: Option<i32>,
    pub valid_until: Option<&'a str>,
    pub password: Option<&'a str>,
}

fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// Build the WITH clause options for CREATE/ALTER ROLE.
/// Returns (options_string, password_param) where password_param is Some(pw) for PASSWORD $1.
pub(super) fn build_role_options(options: RoleOptions<'_>) -> (String, Option<String>) {
    let mut parts: Vec<String> = Vec::new();

    if let Some(v) = options.is_superuser {
        parts.push(if v { "SUPERUSER" } else { "NOSUPERUSER" }.into());
    }
    if let Some(v) = options.inherit {
        parts.push(if v { "INHERIT" } else { "NOINHERIT" }.into());
    }
    if let Some(v) = options.create_role {
        parts.push(if v { "CREATEROLE" } else { "NOCREATEROLE" }.into());
    }
    if let Some(v) = options.create_db {
        parts.push(if v { "CREATEDB" } else { "NOCREATEDB" }.into());
    }
    if let Some(v) = options.can_login {
        parts.push(if v { "LOGIN" } else { "NOLOGIN" }.into());
    }
    if let Some(v) = options.replication {
        parts.push(if v { "REPLICATION" } else { "NOREPLICATION" }.into());
    }
    if let Some(v) = options.bypass_rls {
        parts.push(if v { "BYPASSRLS" } else { "NOBYPASSRLS" }.into());
    }
    if let Some(v) = options.conn_limit {
        parts.push(format!("CONNECTION LIMIT {}", v));
    }
    if let Some(v) = options.valid_until {
        if v.is_empty() {
            parts.push("VALID UNTIL 'infinity'".into());
        } else {
            // Strip single quotes to prevent breaking out of the literal.
            let safe = v.replace('\'', "");
            parts.push(format!("VALID UNTIL '{}'", safe));
        }
    }

    let pass_param = match options.password {
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

pub(super) fn build_create_role_sql(
    role_name: &str,
    options: RoleOptions<'_>,
) -> (String, Option<String>) {
    let (options, pass_param) = build_role_options(options);
    let ident = quote_ident(role_name);
    let sql = if options.is_empty() {
        format!("CREATE ROLE {}", ident)
    } else {
        format!("CREATE ROLE {} WITH {}", ident, options)
    };

    (sql, pass_param)
}

pub(super) fn build_alter_role_sql(
    role_name: &str,
    options: RoleOptions<'_>,
) -> Option<(String, Option<String>)> {
    let (options, pass_param) = build_role_options(options);
    if options.is_empty() {
        return None;
    }

    Some((
        format!("ALTER ROLE {} WITH {}", quote_ident(role_name), options),
        pass_param,
    ))
}

pub(super) fn build_drop_role_sql(role_name: &str) -> String {
    format!("DROP ROLE {}", quote_ident(role_name))
}

pub(super) fn build_role_privilege_sql(
    op: &str,
    object_type: &str,
    schema: &str,
    name: &str,
    privilege: &str,
    role_name: &str,
) -> Result<String, String> {
    let role_ident = quote_ident(role_name);
    match (op, object_type) {
        ("grant", "table") => Ok(format!(
            "GRANT {} ON {}.{} TO {}",
            privilege,
            quote_ident(schema),
            quote_ident(name),
            role_ident
        )),
        ("revoke", "table") => Ok(format!(
            "REVOKE {} ON {}.{} FROM {}",
            privilege,
            quote_ident(schema),
            quote_ident(name),
            role_ident
        )),
        ("grant", "schema") => Ok(format!(
            "GRANT {} ON SCHEMA {} TO {}",
            privilege,
            quote_ident(schema),
            role_ident
        )),
        ("revoke", "schema") => Ok(format!(
            "REVOKE {} ON SCHEMA {} FROM {}",
            privilege,
            quote_ident(schema),
            role_ident
        )),
        _ => Err(format!("Unknown op/object_type: {} / {}", op, object_type)),
    }
}

pub(super) fn format_unknown_role_privilege_sql(
    op: &str,
    schema: &str,
    name: &str,
    privilege: &str,
) -> String {
    format!("{} {} on {}.{}", op, privilege, schema, name)
}

pub(super) fn build_membership_sql(op: &str, role: &str, member: &str) -> Result<String, String> {
    match op {
        "grant" => Ok(format!(
            "GRANT {} TO {}",
            quote_ident(role),
            quote_ident(member)
        )),
        "revoke" => Ok(format!(
            "REVOKE {} FROM {}",
            quote_ident(role),
            quote_ident(member)
        )),
        other => Err(format!("Unknown op: {}", other)),
    }
}

pub(super) fn build_table_privilege_sql(
    op: &str,
    schema: &str,
    table: &str,
    privilege: &str,
    grantee: &str,
) -> Result<String, String> {
    let table_ref = format!("{}.{}", quote_ident(schema), quote_ident(table));
    let grantee_ident = quote_ident(grantee);
    match op {
        "grant" => Ok(format!(
            "GRANT {} ON {} TO {}",
            privilege, table_ref, grantee_ident
        )),
        "revoke" => Ok(format!(
            "REVOKE {} ON {} FROM {}",
            privilege, table_ref, grantee_ident
        )),
        other => Err(format!("Unknown op: {}", other)),
    }
}

pub(super) fn format_unknown_table_privilege_sql(
    op: &str,
    schema: &str,
    table: &str,
    privilege: &str,
    grantee: &str,
) -> String {
    format!(
        "{} {} on {}.{} to {}",
        op,
        privilege,
        quote_ident(schema),
        quote_ident(table),
        grantee
    )
}

pub(super) fn build_schema_privilege_sql(
    op: &str,
    schema: &str,
    privilege: &str,
    grantee: &str,
) -> Result<String, String> {
    let schema_ident = quote_ident(schema);
    let grantee_ident = quote_ident(grantee);
    match op {
        "grant" => Ok(format!(
            "GRANT {} ON SCHEMA {} TO {}",
            privilege, schema_ident, grantee_ident
        )),
        "revoke" => Ok(format!(
            "REVOKE {} ON SCHEMA {} FROM {}",
            privilege, schema_ident, grantee_ident
        )),
        other => Err(format!("Unknown op: {}", other)),
    }
}

pub(super) fn format_unknown_schema_privilege_sql(
    op: &str,
    schema: &str,
    privilege: &str,
    grantee: &str,
) -> String {
    format!("{} {} on schema {} to {}", op, privilege, schema, grantee)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty_role_options<'a>() -> RoleOptions<'a> {
        RoleOptions {
            is_superuser: None,
            inherit: None,
            create_role: None,
            create_db: None,
            can_login: None,
            replication: None,
            bypass_rls: None,
            conn_limit: None,
            valid_until: None,
            password: None,
        }
    }

    #[test]
    fn create_role_sql_quotes_identifier_and_parameterizes_password() {
        let mut options = empty_role_options();
        options.can_login = Some(true);
        options.password = Some("secret");

        let (sql, password) = build_create_role_sql("analyst\"team", options);

        assert_eq!(
            sql,
            "CREATE ROLE \"analyst\"\"team\" WITH LOGIN PASSWORD $1"
        );
        assert_eq!(password.as_deref(), Some("secret"));
    }

    #[test]
    fn alter_role_sql_is_none_when_no_options_change() {
        assert!(build_alter_role_sql("analyst", empty_role_options()).is_none());
    }

    #[test]
    fn role_options_preserve_clear_password_and_valid_until_semantics() {
        let mut options = empty_role_options();
        options.valid_until = Some("");
        options.password = Some("");

        let (sql, password) = build_role_options(options);

        assert_eq!(sql, "VALID UNTIL 'infinity' PASSWORD NULL");
        assert_eq!(password, None);
    }

    #[test]
    fn role_privilege_sql_handles_table_and_schema_targets() {
        assert_eq!(
            build_role_privilege_sql("grant", "table", "public", "events", "SELECT", "reader")
                .unwrap(),
            "GRANT SELECT ON \"public\".\"events\" TO \"reader\""
        );
        assert_eq!(
            build_role_privilege_sql("revoke", "schema", "public", "", "CREATE", "reader").unwrap(),
            "REVOKE CREATE ON SCHEMA \"public\" FROM \"reader\""
        );
    }

    #[test]
    fn membership_and_object_privilege_builders_report_unknown_ops() {
        assert_eq!(
            build_membership_sql("remove", "role", "member").unwrap_err(),
            "Unknown op: remove"
        );
        assert_eq!(
            build_table_privilege_sql("remove", "public", "events", "SELECT", "reader")
                .unwrap_err(),
            "Unknown op: remove"
        );
        assert_eq!(
            build_schema_privilege_sql("remove", "public", "USAGE", "reader").unwrap_err(),
            "Unknown op: remove"
        );
    }

    // Roles are a PostgreSQL-only feature: `commands::roles` rejects
    // `DriverSession::Mysql` before reaching any builder here, so every builder
    // has a single PostgreSQL-flavoured output and no MySQL counterpart.
    #[test]
    fn role_options_emit_the_postgres_keyword_for_each_flag() {
        let mut options = empty_role_options();
        options.is_superuser = Some(true);
        options.inherit = Some(true);
        options.create_role = Some(true);
        options.create_db = Some(true);
        options.can_login = Some(true);
        options.replication = Some(true);
        options.bypass_rls = Some(true);
        options.conn_limit = Some(5);

        let (sql, password) = build_role_options(options);

        assert_eq!(
            sql,
            "SUPERUSER INHERIT CREATEROLE CREATEDB LOGIN REPLICATION BYPASSRLS CONNECTION LIMIT 5"
        );
        assert_eq!(password, None);
    }

    #[test]
    fn role_options_emit_the_negated_postgres_keyword_for_each_cleared_flag() {
        let mut options = empty_role_options();
        options.is_superuser = Some(false);
        options.inherit = Some(false);
        options.create_role = Some(false);
        options.create_db = Some(false);
        options.can_login = Some(false);
        options.replication = Some(false);
        options.bypass_rls = Some(false);

        let (sql, _) = build_role_options(options);

        assert_eq!(
            sql,
            "NOSUPERUSER NOINHERIT NOCREATEROLE NOCREATEDB NOLOGIN NOREPLICATION NOBYPASSRLS"
        );
    }

    #[test]
    fn role_options_strip_quotes_from_valid_until_literals() {
        let mut options = empty_role_options();
        options.valid_until = Some("2030-01-01' OR '1");

        let (sql, _) = build_role_options(options);

        assert_eq!(sql, "VALID UNTIL '2030-01-01 OR 1'");
    }

    #[test]
    fn role_options_are_empty_when_nothing_is_set() {
        let (sql, password) = build_role_options(empty_role_options());

        assert_eq!(sql, "");
        assert_eq!(password, None);
    }

    #[test]
    fn create_role_sql_omits_the_with_clause_when_there_are_no_options() {
        let (sql, password) = build_create_role_sql("analyst", empty_role_options());

        assert_eq!(sql, "CREATE ROLE \"analyst\"");
        assert_eq!(password, None);
    }

    #[test]
    fn alter_role_sql_quotes_identifier_and_parameterizes_password() {
        let mut options = empty_role_options();
        options.can_login = Some(false);
        options.password = Some("secret");

        let (sql, password) = build_alter_role_sql("analyst\"team", options).unwrap();

        assert_eq!(
            sql,
            "ALTER ROLE \"analyst\"\"team\" WITH NOLOGIN PASSWORD $1"
        );
        assert_eq!(password.as_deref(), Some("secret"));
    }

    #[test]
    fn drop_role_sql_quotes_the_identifier() {
        assert_eq!(build_drop_role_sql("analyst"), "DROP ROLE \"analyst\"");
        assert_eq!(
            build_drop_role_sql("analyst\"team"),
            "DROP ROLE \"analyst\"\"team\""
        );
    }

    #[test]
    fn role_privilege_sql_rejects_unknown_op_and_object_type_pairs() {
        assert_eq!(
            build_role_privilege_sql("grant", "sequence", "public", "s", "USAGE", "reader")
                .unwrap_err(),
            "Unknown op/object_type: grant / sequence"
        );
        assert_eq!(
            build_role_privilege_sql("remove", "table", "public", "events", "SELECT", "reader")
                .unwrap_err(),
            "Unknown op/object_type: remove / table"
        );
    }

    #[test]
    fn role_privilege_sql_revokes_table_grants() {
        assert_eq!(
            build_role_privilege_sql("revoke", "table", "public", "events", "SELECT", "reader")
                .unwrap(),
            "REVOKE SELECT ON \"public\".\"events\" FROM \"reader\""
        );
        assert_eq!(
            build_role_privilege_sql("grant", "schema", "public", "", "USAGE", "reader").unwrap(),
            "GRANT USAGE ON SCHEMA \"public\" TO \"reader\""
        );
    }

    #[test]
    fn membership_sql_quotes_both_role_and_member() {
        assert_eq!(
            build_membership_sql("grant", "admin\"s", "ada").unwrap(),
            "GRANT \"admin\"\"s\" TO \"ada\""
        );
        assert_eq!(
            build_membership_sql("revoke", "admins", "ada").unwrap(),
            "REVOKE \"admins\" FROM \"ada\""
        );
    }

    #[test]
    fn table_privilege_sql_quotes_schema_table_and_grantee() {
        assert_eq!(
            build_table_privilege_sql("grant", "public", "events", "SELECT", "reader").unwrap(),
            "GRANT SELECT ON \"public\".\"events\" TO \"reader\""
        );
        assert_eq!(
            build_table_privilege_sql("revoke", "public", "events", "SELECT", "reader").unwrap(),
            "REVOKE SELECT ON \"public\".\"events\" FROM \"reader\""
        );
    }

    #[test]
    fn schema_privilege_sql_quotes_schema_and_grantee() {
        assert_eq!(
            build_schema_privilege_sql("grant", "public", "USAGE", "reader").unwrap(),
            "GRANT USAGE ON SCHEMA \"public\" TO \"reader\""
        );
        assert_eq!(
            build_schema_privilege_sql("revoke", "public", "USAGE", "reader").unwrap(),
            "REVOKE USAGE ON SCHEMA \"public\" FROM \"reader\""
        );
    }

    #[test]
    fn unknown_op_formatters_produce_unquoted_audit_strings() {
        assert_eq!(
            format_unknown_role_privilege_sql("remove", "public", "events", "SELECT"),
            "remove SELECT on public.events"
        );
        assert_eq!(
            format_unknown_table_privilege_sql("remove", "public", "events", "SELECT", "reader"),
            "remove SELECT on \"public\".\"events\" to reader"
        );
        assert_eq!(
            format_unknown_schema_privilege_sql("remove", "public", "USAGE", "reader"),
            "remove USAGE on schema public to reader"
        );
    }
}
