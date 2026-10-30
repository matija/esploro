use http_body_util::Full;
use hyper::{server::conn::http1, service::service_fn};
use hyper_util::rt::TokioIo;
use std::{
    convert::Infallible,
    io,
    net::SocketAddr,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncWrite, ReadBuf},
    net::{TcpListener, TcpStream},
    sync::{oneshot, watch, Semaphore},
    task::{JoinHandle, JoinSet},
    time::Instant,
};

struct TimedSocket {
    socket: TcpStream,
    deadline: watch::Sender<Option<(Instant, bool)>>,
}

impl AsyncRead for TimedSocket {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let before = buf.filled().len();
        let result = Pin::new(&mut self.socket).poll_read(cx, buf);
        if buf.filled().len() > before {
            self.deadline.send_if_modified(|state| {
                if state.is_some_and(|(_, idle)| idle) {
                    *state = Some((Instant::now() + Duration::from_secs(5), false));
                    true
                } else {
                    false
                }
            });
        }
        result
    }
}

impl AsyncWrite for TimedSocket {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.socket).poll_write(cx, buf)
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.socket).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.socket).poll_shutdown(cx)
    }
}

pub struct McpListener {
    stop: Option<oneshot::Sender<()>>,
    task: JoinHandle<io::Result<()>>,
}

impl McpListener {
    pub async fn bind(token: String, app: tauri::AppHandle) -> io::Result<Self> {
        Self::bind_at("127.0.0.1:19482".parse().unwrap(), token, Some(app)).await
    }

    pub async fn bind_at<R: tauri::Runtime>(
        address: SocketAddr,
        token: String,
        app: Option<tauri::AppHandle<R>>,
    ) -> io::Result<Self> {
        let listener = TcpListener::bind(address).await.map_err(|error| {
            io::Error::new(error.kind(), format!("Cannot bind MCP listener at {address}: {error}. Stop the process using this port and retry; MCP will not use another port."))
        })?;
        let token = Arc::new(token);
        let (stop, mut stopped) = oneshot::channel();
        let task = tokio::spawn(async move {
            let mut connections = JoinSet::new();
            let capacity = Arc::new(Semaphore::new(16));
            let result = loop {
                tokio::select! {
                    _ = &mut stopped => break Ok(()),
                    Some(_) = connections.join_next(), if !connections.is_empty() => {},
                    accepted = listener.accept() => {
                        let (socket, _) = match accepted {
                            Ok(connection) => connection,
                            Err(error) => break Err(error),
                        };
                        let Ok(permit) = capacity.clone().try_acquire_owned() else {
                            drop(socket);
                            continue;
                        };
                        let token = token.clone();
                        let app = app.clone();
                        connections.spawn(async move {
                            let _permit = permit;
                            let (deadline, mut changes) = watch::channel(Some((Instant::now() + Duration::from_secs(5), false)));
                            let socket = TimedSocket { socket, deadline: deadline.clone() };
                            let service = service_fn(move |request| {
                                deadline.send_replace(None);
                                let deadline = deadline.clone();
                                let token = token.clone();
                                let app = app.clone();
                                async move {
                                    let response = super::transport::handle_with_app(request, &token, app.as_ref()).await
                                        .map(|body| Full::new(hyper::body::Bytes::from(body)));
                                    deadline.send_replace(Some((Instant::now() + Duration::from_secs(15), true)));
                                    Ok::<_, Infallible>(response)
                                }
                            });
                            let builder = http1::Builder::new();
                            let connection = builder.serve_connection(TokioIo::new(socket), service);
                            tokio::pin!(connection);
                            loop {
                                let deadline = *changes.borrow_and_update();
                                tokio::select! {
                                    _ = &mut connection => break,
                                    _ = changes.changed() => {},
                                    _ = async {
                                        match deadline {
                                            Some((at, _)) => tokio::time::sleep_until(at).await,
                                            None => std::future::pending().await,
                                        }
                                    } => break,
                                }
                            }
                        });
                    }
                }
            };
            drop(listener);
            connections.shutdown().await;
            result
        });
        Ok(Self {
            stop: Some(stop),
            task,
        })
    }

    pub async fn shutdown(mut self) -> io::Result<()> {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        match tokio::time::timeout(Duration::from_secs(2), &mut self.task).await {
            Ok(result) => result.map_err(io::Error::other)?,
            Err(_) => {
                self.task.abort();
                let _ = (&mut self.task).await;
                Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "MCP listener shutdown timed out",
                ))
            }
        }
    }
}

impl Drop for McpListener {
    fn drop(&mut self) {
        self.task.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpStream,
    };

    async fn start() -> (McpListener, SocketAddr) {
        let reserved = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = reserved.local_addr().unwrap();
        drop(reserved);
        (
            McpListener::bind_at::<tauri::Wry>(address, "test-token".into(), None)
                .await
                .unwrap(),
            address,
        )
    }

    async fn closed(socket: &mut TcpStream) {
        let mut bytes = Vec::new();
        let _ = tokio::time::timeout(Duration::from_secs(2), socket.read_to_end(&mut bytes))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn partial_requests_expire_and_capacity_recovers() {
        let (server, address) = start().await;
        let mut sockets = Vec::new();
        for _ in 0..16 {
            let mut socket = TcpStream::connect(address).await.unwrap();
            socket.write_all(b"POST /mcp HTTP/1.1\r\n").await.unwrap();
            sockets.push(socket);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
        let mut excess = TcpStream::connect(address).await.unwrap();
        closed(&mut excess).await;
        tokio::time::sleep(Duration::from_secs(5)).await;
        for socket in &mut sockets {
            closed(socket).await;
        }
        let mut recovered = TcpStream::connect(address).await.unwrap();
        recovered.write_all(b"POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:19482\r\nAuthorization: Bearer test-token\r\nContent-Length: 100\r\n\r\n{").await.unwrap();
        let mut response = String::new();
        tokio::time::timeout(
            Duration::from_secs(7),
            recovered.read_to_string(&mut response),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(response.starts_with("HTTP/1.1 408"), "{response}");
        server.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn keep_alive_expires_after_fifteen_seconds() {
        let (server, address) = start().await;
        let mut socket = TcpStream::connect(address).await.unwrap();
        let body = r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#;
        socket.write_all(format!("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:19482\r\nAuthorization: Bearer test-token\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nMCP-Protocol-Version: 2025-06-18\r\nContent-Length: {}\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
        let mut response = [0; 4096];
        let count = socket.read(&mut response).await.unwrap();
        assert!(response[..count].starts_with(b"HTTP/1.1 200"));
        assert!(
            tokio::time::timeout(Duration::from_secs(6), socket.read(&mut response))
                .await
                .is_err()
        );
        tokio::time::sleep(Duration::from_secs(10)).await;
        closed(&mut socket).await;
        server.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn port_conflict_is_actionable() {
        let occupied = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = occupied.local_addr().unwrap();
        let error = McpListener::bind_at::<tauri::Wry>(address, "test-token".into(), None)
            .await
            .err()
            .unwrap();
        assert_eq!(error.kind(), io::ErrorKind::AddrInUse);
        assert!(error.to_string().contains(&address.to_string()));
        assert!(error.to_string().contains("Stop the process"));
        assert!(error.to_string().contains("will not use another port"));
    }

    #[tokio::test]
    async fn endpoint_uses_guarded_handler() {
        let (server, address) = start().await;
        for (path, token, status) in [
            ("/mcp", "test-token", "200"),
            ("/other", "test-token", "404"),
            ("/mcp", "wrong", "401"),
        ] {
            let mut socket = TcpStream::connect(address).await.unwrap();
            let body = r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#;
            socket.write_all(format!("POST {path} HTTP/1.1\r\nHost: 127.0.0.1:19482\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nMCP-Protocol-Version: 2025-06-18\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
            let mut response = String::new();
            tokio::time::timeout(Duration::from_secs(2), socket.read_to_string(&mut response))
                .await
                .unwrap()
                .unwrap();
            assert!(
                response.starts_with(&format!("HTTP/1.1 {status}")),
                "{response}"
            );
        }
        server.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn shutdown_closes_idle_and_partial_connections_and_releases_port() {
        let (server, address) = start().await;
        let mut sockets = Vec::new();
        for index in 0..16 {
            let mut socket = TcpStream::connect(address).await.unwrap();
            match index % 3 {
                0 => {},
                1 => socket.write_all(b"POST /mcp HTTP/1.1\r\n").await.unwrap(),
                _ => socket.write_all(b"POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:19482\r\nAuthorization: Bearer test-token\r\nContent-Length: 100\r\n\r\n{").await.unwrap(),
            }
            sockets.push(socket);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
        tokio::time::timeout(Duration::from_secs(3), server.shutdown())
            .await
            .unwrap()
            .unwrap();
        for socket in &mut sockets {
            let result = tokio::time::timeout(Duration::from_secs(1), socket.read(&mut [0]))
                .await
                .unwrap();
            assert!(matches!(result, Ok(0) | Err(_)));
        }
        assert!(TcpStream::connect(address).await.is_err());
        let _rebound = TcpListener::bind(address).await.unwrap();
    }
}
