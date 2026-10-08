use super::MAX_HTTP_BODY_BYTES;
use http::{header, Request, StatusCode};
use http_body::Body;
use http_body_util::{BodyExt, Limited};
use subtle::ConstantTimeEq;

pub async fn guard<B: Body>(
    request: Request<B>,
    token: &str,
) -> Result<Request<Vec<u8>>, StatusCode>
where
    B::Error: Into<Box<dyn std::error::Error + Send + Sync>>,
{
    let headers = request.headers();
    let mut hosts = headers.get_all(header::HOST).iter();
    if hosts.next().map(|host| host.as_bytes()) != Some(b"127.0.0.1:19482")
        || hosts.next().is_some()
        || headers.contains_key(header::ORIGIN)
    {
        return Err(StatusCode::FORBIDDEN);
    }
    let mut authorizations = headers.get_all(header::AUTHORIZATION).iter();
    let supplied = authorizations
        .next()
        .and_then(|value| value.as_bytes().strip_prefix(b"Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?;
    if token.is_empty()
        || authorizations.next().is_some()
        || !bool::from(supplied.ct_eq(token.as_bytes()))
    {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let (parts, body) = request.into_parts();
    let body = Limited::new(body, MAX_HTTP_BODY_BYTES)
        .collect()
        .await
        .map_err(|error| {
            if error.is::<http_body_util::LengthLimitError>() {
                StatusCode::PAYLOAD_TOO_LARGE
            } else {
                StatusCode::BAD_REQUEST
            }
        })?
        .to_bytes()
        .to_vec();
    Ok(Request::from_parts(parts, body))
}

pub const PROTOCOL_VERSION: &str = "2025-06-18";

pub async fn handle<B: Body>(request: Request<B>, token: &str) -> http::Response<Vec<u8>>
where
    B::Error: Into<Box<dyn std::error::Error + Send + Sync>>,
{
    handle_with_app(request, token, None).await
}

pub async fn handle_with_app<B: Body>(
    request: Request<B>,
    token: &str,
    app: Option<&tauri::AppHandle>,
) -> http::Response<Vec<u8>>
where
    B::Error: Into<Box<dyn std::error::Error + Send + Sync>>,
{
    use serde_json::{json, Value};
    let request = match guard(request, token).await {
        Ok(request) => request,
        Err(status) => return response(status, None),
    };
    if request.uri().path() != "/mcp" {
        return response(StatusCode::NOT_FOUND, None);
    }
    if request.method() != http::Method::POST {
        let mut result = response(StatusCode::METHOD_NOT_ALLOWED, None);
        result
            .headers_mut()
            .insert(header::ALLOW, "POST".parse().unwrap());
        return result;
    }
    let headers = request.headers();
    let single_header = |name: &str| {
        let mut values = headers.get_all(name).iter();
        let value = values.next()?.to_str().ok()?;
        if values.next().is_some() {
            None
        } else {
            Some(value)
        }
    };
    if !single_header("content-type").is_some_and(|value| {
        value
            .split(';')
            .next()
            .unwrap()
            .trim()
            .eq_ignore_ascii_case("application/json")
    }) {
        return response(StatusCode::UNSUPPORTED_MEDIA_TYPE, None);
    }
    let accepts = |media: &str| {
        headers.get_all(header::ACCEPT).iter().any(|value| {
            value.to_str().is_ok_and(|value| {
                value.split(',').any(|entry| {
                    let mut parts = entry.split(';');
                    parts.next().unwrap().trim().eq_ignore_ascii_case(media)
                        && parts.all(|part| {
                            !part.trim().starts_with("q=")
                                || part.trim()[2..]
                                    .parse::<f32>()
                                    .is_ok_and(|q| q > 0.0 && q <= 1.0)
                        })
                })
            })
        })
    };
    if !accepts("application/json") || !accepts("text/event-stream") {
        return response(StatusCode::NOT_ACCEPTABLE, None);
    }
    if headers.contains_key("mcp-protocol-version")
        && single_header("mcp-protocol-version") != Some(PROTOCOL_VERSION)
    {
        return response(StatusCode::BAD_REQUEST, None);
    }
    let message: Value = match serde_json::from_slice(request.body()) {
        Ok(message) => message,
        Err(_) => return rpc_error(StatusCode::BAD_REQUEST, Value::Null, -32700, "Parse error"),
    };
    let id = message.get("id").cloned();
    let valid_id = id
        .as_ref()
        .is_none_or(|id| id.is_string() || id.as_i64().is_some() || id.as_u64().is_some());
    let method = message.get("method").and_then(Value::as_str);
    if !message.is_object()
        || message["jsonrpc"] != "2.0"
        || !valid_id
        || method.is_none()
        || message.get("result").is_some()
        || message.get("error").is_some()
        || message
            .get("params")
            .is_some_and(|params| !params.is_object())
    {
        return rpc_error(
            StatusCode::BAD_REQUEST,
            Value::Null,
            -32600,
            "Invalid Request",
        );
    }
    let method = method.unwrap();
    if method != "initialize" && !headers.contains_key("mcp-protocol-version") {
        return response(StatusCode::BAD_REQUEST, None);
    }
    if id.is_none() {
        if method == "initialize" {
            return rpc_error(
                StatusCode::BAD_REQUEST,
                Value::Null,
                -32600,
                "Invalid Request",
            );
        }
        return response(StatusCode::ACCEPTED, None);
    }
    let id = id.unwrap();
    let params = &message["params"];
    let result = match method {
        "initialize" => {
            if !params["protocolVersion"].is_string()
                || !params["capabilities"].is_object()
                || !params["clientInfo"]["name"].is_string()
                || !params["clientInfo"]["version"].is_string()
            {
                return rpc_error(StatusCode::OK, id, -32602, "Invalid params");
            }
            json!({"protocolVersion": PROTOCOL_VERSION, "capabilities": {"tools": {}},
                "serverInfo": {"name": "esploro", "version": env!("CARGO_PKG_VERSION")}})
        }
        "ping" => json!({}),
        "tools/list" => {
            if params
                .get("cursor")
                .is_some_and(|cursor| !cursor.is_string())
            {
                return rpc_error(StatusCode::OK, id, -32602, "Invalid params");
            }
            json!({"tools": super::tools::definitions()})
        }
        "tools/call" => {
            let Some(name) = params["name"].as_str() else {
                return rpc_error(StatusCode::OK, id, -32602, "Invalid params");
            };
            let arguments = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            match super::tools::call(app, name, &arguments).await {
                Ok(result) => result,
                Err(error) => return rpc_error(StatusCode::OK, id, -32602, error),
            }
        }
        _ => return rpc_error(StatusCode::OK, id, -32601, "Method not found"),
    };
    response(
        StatusCode::OK,
        Some(json!({"jsonrpc": "2.0", "id": id, "result": result})),
    )
}

fn response(status: StatusCode, body: Option<serde_json::Value>) -> http::Response<Vec<u8>> {
    let mut builder = http::Response::builder().status(status);
    if body.is_some() {
        builder = builder.header(header::CONTENT_TYPE, "application/json");
    }
    builder
        .body(
            body.map(|body| serde_json::to_vec(&body).unwrap())
                .unwrap_or_default(),
        )
        .unwrap()
}

fn rpc_error(
    status: StatusCode,
    id: serde_json::Value,
    code: i32,
    message: &str,
) -> http::Response<Vec<u8>> {
    response(
        status,
        Some(
            serde_json::json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}}),
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use http_body_util::Full;

    const TOKEN: &str = "0123456789abcdef";

    fn request() -> http::request::Builder {
        Request::builder()
            .method("POST")
            .uri("/mcp")
            .header(header::HOST, "127.0.0.1:19482")
            .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"))
    }

    async fn post(body: &str) -> http::Response<Vec<u8>> {
        handle(
            request()
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::ACCEPT, "application/json, text/event-stream")
                .header("mcp-protocol-version", PROTOCOL_VERSION)
                .body(Full::new(body.as_bytes()))
                .unwrap(),
            TOKEN,
        )
        .await
    }

    fn json(response: &http::Response<Vec<u8>>) -> serde_json::Value {
        serde_json::from_slice(response.body()).unwrap()
    }

    #[tokio::test]
    async fn tools_require_authentication_and_validate_arguments() {
        for (name, arguments) in [
            ("list_connections", serde_json::json!({})),
            (
                "inspect_schema",
                serde_json::json!({"connectionId":"saved"}),
            ),
        ] {
            let body = serde_json::json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":name,"arguments":arguments}}).to_string();
            let unauthorized = handle(
                Request::builder()
                    .method("POST")
                    .uri("/mcp")
                    .header(header::HOST, "127.0.0.1:19482")
                    .header(header::AUTHORIZATION, "Bearer wrong")
                    .body(Full::new(body.as_bytes()))
                    .unwrap(),
                TOKEN,
            )
            .await;
            assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);
            assert!(unauthorized.body().is_empty());
            let authenticated = post(&body).await;
            assert_eq!(json(&authenticated)["result"]["isError"], true);
            assert!(json(&authenticated)["result"]["content"][0]["text"]
                .as_str()
                .unwrap()
                .contains("Application is unavailable"));
        }
        for params in [
            serde_json::json!({"name":"inspect_schema","arguments":{}}),
            serde_json::json!({"name":"inspect_schema","arguments":{"connectionId":""}}),
            serde_json::json!({"name":"inspect_schema","arguments":{"connectionId":1}}),
            serde_json::json!({"name":"inspect_schema","arguments":{"sessionId":"saved"}}),
            serde_json::json!({"name":"list_connections","arguments":{"password":"secret"}}),
            serde_json::json!({"name":"unknown"}),
        ] {
            let response = post(
                &serde_json::json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":params})
                    .to_string(),
            )
            .await;
            assert_eq!(json(&response)["error"]["code"], -32602);
        }
    }

    #[tokio::test]
    async fn handshake_and_version_negotiation() {
        for version in [PROTOCOL_VERSION, "unknown"] {
            let body = serde_json::json!({"jsonrpc":"2.0", "id":1, "method":"initialize",
                "params":{"protocolVersion":version,"capabilities":{},"clientInfo":{"name":"test","version":"1"}}}).to_string();
            let response = handle(
                request()
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::ACCEPT, "application/json, text/event-stream")
                    .body(Full::new(body.as_bytes()))
                    .unwrap(),
                TOKEN,
            )
            .await;
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(
                json(&response)["result"]["protocolVersion"],
                PROTOCOL_VERSION
            );
            assert_eq!(
                json(&response)["result"]["capabilities"],
                serde_json::json!({"tools":{}})
            );
            assert!(!response.headers().contains_key("mcp-session-id"));
        }
    }

    #[tokio::test]
    async fn notifications_ping_and_discovery() {
        for method in ["notifications/initialized", "notifications/unknown"] {
            let response = post(&format!(r#"{{"jsonrpc":"2.0","method":"{method}"}}"#)).await;
            assert_eq!(response.status(), StatusCode::ACCEPTED);
            assert!(response.body().is_empty());
        }
        for (method, result) in [
            ("ping", serde_json::json!({})),
            (
                "tools/list",
                serde_json::json!({"tools":super::super::tools::definitions()}),
            ),
        ] {
            let response = post(&format!(
                r#"{{"jsonrpc":"2.0","id":"abc","method":"{method}"}}"#
            ))
            .await;
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.headers()[header::CONTENT_TYPE], "application/json");
            assert_eq!(
                json(&response),
                serde_json::json!({"jsonrpc":"2.0","id":"abc","result":result})
            );
        }
    }

    #[tokio::test]
    async fn protocol_errors() {
        for (body, code) in [
            ("{", -32700),
            ("[]", -32600),
            ("null", -32600),
            (r#"{"jsonrpc":"1.0","id":1,"method":"ping"}"#, -32600),
            (r#"{"jsonrpc":"2.0","id":null,"method":"ping"}"#, -32600),
            (r#"{"jsonrpc":"2.0","id":true,"method":"ping"}"#, -32600),
            (r#"{"jsonrpc":"2.0","id":1,"method":"unknown"}"#, -32601),
            (
                r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#,
                -32602,
            ),
            (
                r#"{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"cursor":1}}"#,
                -32602,
            ),
        ] {
            assert_eq!(json(&post(body).await)["error"]["code"], code, "{body}");
        }
    }

    #[tokio::test]
    async fn transport_headers_and_guard() {
        for (name, value, status) in [
            (
                "content-type",
                "text/plain",
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
            ),
            ("accept", "application/json", StatusCode::NOT_ACCEPTABLE),
            (
                "accept",
                "application/json, text/event-stream;q=0",
                StatusCode::NOT_ACCEPTABLE,
            ),
            ("mcp-protocol-version", "unknown", StatusCode::BAD_REQUEST),
            ("authorization", "Bearer wrong", StatusCode::UNAUTHORIZED),
        ] {
            let mut req = request()
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::ACCEPT, "application/json, text/event-stream")
                .header("mcp-protocol-version", PROTOCOL_VERSION)
                .body(Full::new(&b"{}"[..]))
                .unwrap();
            req.headers_mut().insert(
                http::HeaderName::from_bytes(name.as_bytes()).unwrap(),
                value.parse().unwrap(),
            );
            assert_eq!(handle(req, TOKEN).await.status(), status);
        }
        let response = handle(
            request().method("GET").body(Full::new(&b""[..])).unwrap(),
            TOKEN,
        )
        .await;
        assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
        assert_eq!(response.headers()[header::ALLOW], "POST");
    }

    #[tokio::test]
    async fn accepts_valid_requests_and_preserves_request() {
        let body = vec![b'x'; MAX_HTTP_BODY_BYTES];
        let guarded = guard(request().body(Full::new(body.as_slice())).unwrap(), TOKEN)
            .await
            .unwrap();
        assert_eq!(guarded.method(), "POST");
        assert_eq!(guarded.uri(), "/mcp");
        assert_eq!(guarded.body(), &body);
    }

    #[tokio::test]
    async fn rejects_missing_wrong_and_duplicate_tokens() {
        for authorization in [
            None,
            Some("Bearer wrong"),
            Some("Bearer 0123456789abcdeg"),
            Some("Basic 0123456789abcdef"),
            Some("Bearer "),
        ] {
            let mut builder = Request::builder().header(header::HOST, "127.0.0.1:19482");
            if let Some(value) = authorization {
                builder = builder.header(header::AUTHORIZATION, value);
            }
            assert_eq!(
                guard(builder.body(Full::new(&b""[..])).unwrap(), TOKEN)
                    .await
                    .unwrap_err(),
                StatusCode::UNAUTHORIZED
            );
        }
        assert_eq!(
            guard(
                request()
                    .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"))
                    .body(Full::new(&b""[..]))
                    .unwrap(),
                TOKEN
            )
            .await
            .unwrap_err(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            guard(request().body(Full::new(&b""[..])).unwrap(), "")
                .await
                .unwrap_err(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn rejects_missing_wrong_and_duplicate_hosts() {
        for host in [
            None,
            Some("localhost:19482"),
            Some("127.0.0.1"),
            Some("127.0.0.1:19483"),
            Some("127.0.0.1:19482, 127.0.0.1:19482"),
        ] {
            let mut builder =
                Request::builder().header(header::AUTHORIZATION, format!("Bearer {TOKEN}"));
            if let Some(value) = host {
                builder = builder.header(header::HOST, value);
            }
            assert_eq!(
                guard(builder.body(Full::new(&b""[..])).unwrap(), TOKEN)
                    .await
                    .unwrap_err(),
                StatusCode::FORBIDDEN
            );
        }
        assert_eq!(
            guard(
                request()
                    .header(header::HOST, "127.0.0.1:19482")
                    .body(Full::new(&b""[..]))
                    .unwrap(),
                TOKEN
            )
            .await
            .unwrap_err(),
            StatusCode::FORBIDDEN
        );
    }

    #[tokio::test]
    async fn rejects_any_origin() {
        for origin in ["", "null", "http://127.0.0.1:19482"] {
            assert_eq!(
                guard(
                    request()
                        .header(header::ORIGIN, origin)
                        .body(Full::new(&b""[..]))
                        .unwrap(),
                    TOKEN
                )
                .await
                .unwrap_err(),
                StatusCode::FORBIDDEN
            );
        }
    }

    #[tokio::test]
    async fn rejects_oversized_bodies_without_trusting_content_length() {
        let body = vec![b'x'; MAX_HTTP_BODY_BYTES + 1];
        for length in [None, Some("0")] {
            let mut builder = request();
            if let Some(value) = length {
                builder = builder.header(header::CONTENT_LENGTH, value);
            }
            assert_eq!(
                guard(builder.body(Full::new(body.as_slice())).unwrap(), TOKEN)
                    .await
                    .unwrap_err(),
                StatusCode::PAYLOAD_TOO_LARGE
            );
        }
    }
}
