use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use clap::Parser;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

#[derive(Parser, Debug)]
#[command(about = "Generate an Esploro license key")]
struct Args {
    #[arg(long, default_value = "commercial")]
    tier: String,

    #[arg(long)]
    licensee: String,

    /// Expiry date as YYYY-MM-DD; omit for a perpetual license
    #[arg(long)]
    expires: Option<String>,

    /// Maximum seats; omit for unlimited
    #[arg(long)]
    max_seats: Option<u32>,
}

#[derive(Serialize, Deserialize)]
struct LicensePayload {
    version: u32,
    tier: String,
    issued_at: String,
    expires_at: Option<String>,
    licensee: String,
    max_seats: Option<u32>,
    key_id: String,
}

fn main() {
    let args = Args::parse();

    let secret_key = std::env::var("ESPLORO_LICENSE_SECRET_KEY")
        .expect("ESPLORO_LICENSE_SECRET_KEY must be set");

    let expires_at = args.expires.map(|d| format!("{d}T00:00:00Z"));

    let payload = LicensePayload {
        version: 1,
        tier: args.tier,
        issued_at: chrono::Utc::now().to_rfc3339(),
        expires_at,
        licensee: args.licensee,
        max_seats: args.max_seats,
        key_id: Uuid::new_v4().to_string(),
    };

    let payload_json = serde_json::to_vec(&payload).expect("serialize payload");
    let payload_b64 = URL_SAFE_NO_PAD.encode(&payload_json);

    let mut mac =
        HmacSha256::new_from_slice(secret_key.as_bytes()).expect("HMAC accepts any key length");
    mac.update(&payload_json);
    let sig = mac.finalize().into_bytes();
    let sig_b64 = URL_SAFE_NO_PAD.encode(sig.as_slice());

    println!("ESPLORO-{}.{}", payload_b64, sig_b64);
}
