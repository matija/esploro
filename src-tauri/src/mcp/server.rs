use http_body_util::Full;
use hyper::{server::conn::http1, service::service_fn};
use hyper_util::rt::TokioIo;
use std::{convert::Infallible, io, net::SocketAddr, sync::Arc, time::Duration};
use tokio::{
    net::TcpListener,
    sync::oneshot,
    task::{JoinHandle, JoinSet},
};

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
            let result = loop {
                tokio::select! {
                    _ = &mut stopped => break Ok(()),
                    Some(_) = connections.join_next(), if !connections.is_empty() => {},
                    accepted = listener.accept() => {
                        let (socket, _) = match accepted {
                            Ok(connection) => connection,
                            Err(error) => break Err(error),
                        };
                        let token = token.clone();
                        let app = app.clone();
                        connections.spawn(async move {
                            let service = service_fn(move |request| {
                                let token = token.clone();
                                let app = app.clone();
                                async move {
                                    Ok::<_, Infallible>(super::transport::handle_with_app(request, &token, app.as_ref()).await
                                        .map(|body| Full::new(hyper::body::Bytes::from(body))))
                                }
                            });
                            let _ = http1::Builder::new().serve_connection(TokioIo::new(socket), service).await;
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
        let mut idle = TcpStream::connect(address).await.unwrap();
        let mut partial = TcpStream::connect(address).await.unwrap();
        partial.write_all(b"POST /mcp HTTP/1.1\r\n").await.unwrap();
        tokio::time::timeout(Duration::from_secs(3), server.shutdown())
            .await
            .unwrap()
            .unwrap();
        for socket in [&mut idle, &mut partial] {
            let result = tokio::time::timeout(Duration::from_secs(1), socket.read(&mut [0]))
                .await
                .unwrap();
            assert!(matches!(result, Ok(0) | Err(_)));
        }
        assert!(TcpStream::connect(address).await.is_err());
        let _rebound = TcpListener::bind(address).await.unwrap();
    }
}
