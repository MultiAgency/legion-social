use anyhow::{bail, Context, Result};
use fastnear_primitives::types::ChainId;
use std::env;
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Clone, Copy)]
pub enum StartBlock {
    Height(u64),
    /// Start at the current final block (development only).
    Latest,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub chain_id: ChainId,
    /// The receiver account all writes go to (`social`).
    pub social_account_id: String,
    pub start_block: Option<StartBlock>,
    pub indexer_enabled: bool,
    pub num_threads: u64,
    pub auth_bearer_token: Option<String>,
    pub block_update_interval: Duration,
    pub data_dir: PathBuf,
    pub bind: String,
    pub port: u16,
    /// Public base URL of this API, used in docs.
    pub public_url: String,
    pub rpc_url: String,
    pub fastfs_gateway: String,
    pub legacy_api_url: String,
    pub legacy_contract: String,
    pub ipfs_gateways: Vec<String>,
    /// Referer sent with legacy image requests (the near.social IPFS mirror requires one).
    pub legacy_referer: String,
    /// near.social's image proxy (`{proxy}/large/{url}`), whose cache outlives dead gateways.
    pub legacy_image_proxy: String,
    /// near.social's account-avatar resolver (`{url}/{account_id}` → image URL).
    pub legacy_magic_url: String,
    /// Per-request timeout for the IPFS mirror (the first `IPFS_GATEWAYS` entry), which may need
    /// time to pull unpinned content.
    pub legacy_mirror_timeout: Duration,
    /// Per-request timeout for every other host.
    pub legacy_fetch_timeout: Duration,
    /// Overall time budget for importing one legacy image.
    pub legacy_image_budget: Duration,
    pub denylist_path: Option<PathBuf>,
}

fn var(name: &str) -> Option<String> {
    env::var(name).ok().filter(|v| !v.trim().is_empty())
}

fn var_or(name: &str, default: &str) -> String {
    var(name).unwrap_or_else(|| default.to_string())
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let chain_id: ChainId = var_or("CHAIN_ID", "mainnet")
            .try_into()
            .map_err(|e: String| anyhow::anyhow!(e))?;
        let mainnet = matches!(chain_id, ChainId::Mainnet);
        let start_block = match var("START_BLOCK_HEIGHT") {
            None => None,
            Some(v) if v == "latest" => Some(StartBlock::Latest),
            Some(v) => Some(StartBlock::Height(v.parse().context("START_BLOCK_HEIGHT")?)),
        };
        let port: u16 = var_or("PORT", "3040").parse().context("PORT")?;
        let social_account_id = var_or("SOCIAL_ACCOUNT_ID", "social");
        if !crate::model::account_id::is_valid_account_id(&social_account_id) {
            bail!("SOCIAL_ACCOUNT_ID is not a valid account ID");
        }
        Ok(Self {
            chain_id,
            social_account_id,
            start_block,
            indexer_enabled: var_or("INDEXER", "on") != "off",
            num_threads: var_or("NUM_THREADS", "8").parse().context("NUM_THREADS")?,
            auth_bearer_token: var("FASTNEAR_AUTH_BEARER_TOKEN"),
            block_update_interval: Duration::from_millis(
                var_or("BLOCK_UPDATE_INTERVAL_MS", "5000").parse().context("BLOCK_UPDATE_INTERVAL_MS")?,
            ),
            data_dir: PathBuf::from(var_or("DATA_DIR", "./data")),
            bind: var_or("BIND", "127.0.0.1"),
            port,
            public_url: var_or("PUBLIC_URL", &format!("http://127.0.0.1:{port}"))
                .trim_end_matches('/')
                .to_string(),
            rpc_url: var_or(
                "RPC_URL",
                if mainnet { "https://rpc.mainnet.fastnear.com" } else { "https://rpc.testnet.fastnear.com" },
            ),
            fastfs_gateway: var_or(
                "FASTFS_GATEWAY",
                if mainnet { "https://main.fastfs.io" } else { "https://test.fastfs.io" },
            )
            .trim_end_matches('/')
            .to_string(),
            legacy_api_url: var_or("LEGACY_API_URL", "https://api.near.social").trim_end_matches('/').to_string(),
            legacy_contract: var_or("LEGACY_CONTRACT", "social.near"),
            ipfs_gateways: var_or("IPFS_GATEWAYS", "https://ipfs.near.social,https://ipfs.io,https://dweb.link")
                .split(',')
                .map(|g| g.trim().trim_end_matches('/').to_string())
                .filter(|g| !g.is_empty())
                .collect(),
            legacy_referer: var_or("LEGACY_REFERER", "https://near.social/"),
            legacy_image_proxy: var_or("LEGACY_IMAGE_PROXY", "https://i.near.social").trim_end_matches('/').to_string(),
            legacy_magic_url: var_or("LEGACY_MAGIC_URL", "https://near.social/magic/img/account")
                .trim_end_matches('/')
                .to_string(),
            legacy_mirror_timeout: Duration::from_secs(
                var_or("LEGACY_MIRROR_TIMEOUT_SECS", "30").parse().context("LEGACY_MIRROR_TIMEOUT_SECS")?,
            ),
            legacy_fetch_timeout: Duration::from_secs(
                var_or("LEGACY_FETCH_TIMEOUT_SECS", "8").parse().context("LEGACY_FETCH_TIMEOUT_SECS")?,
            ),
            legacy_image_budget: Duration::from_secs(
                var_or("LEGACY_IMAGE_BUDGET_SECS", "45").parse().context("LEGACY_IMAGE_BUDGET_SECS")?,
            ),
            denylist_path: var("DENYLIST_PATH").map(PathBuf::from),
        })
    }
}
