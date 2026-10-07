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
