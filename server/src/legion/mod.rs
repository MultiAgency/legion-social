//! NEAR Legion membership: the read-time filter that turns this indexer into a Legion layer.
//!
//! Membership is derived from chain, never written to `social`: an account is a member at the
//! highest rank whose soulbound NFT contract says it holds a token (NEP-181
//! `nft_supply_for_owner`). Only accounts the indexer has seen are checked: a contract's
//! `nft_tokens` can't page through all holders within view gas, and only accounts that appear
//! on `social` need a rank. An account is checked soon after it first appears, and rechecked
//! every `LEGION_REFRESH_SECS`, which is when a mint or a revocation shows.
//!
//! Until an account is checked, and while it isn't a member, it's hidden like a denylisted one
//! (`State::is_hidden`). With `LEGION_CONTRACTS` unset none of this runs, and the server behaves
//! like upstream near.social.
//!
//! Checks go to `RPC_URL` with `FASTNEAR_AUTH_BEARER_TOKEN` when it's set: FastNEAR's public RPC
//! answers a burst of unauthenticated views with 429. After a batch with failures the next one
//! waits twice as long, up to `MAX_BACKOFF`.

use crate::config::Config;
use crate::state::{Aid, State};
use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use futures::{stream, StreamExt};
use parking_lot::RwLock;
use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const PROJECT_ID: &str = "legion";
const SNAPSHOT_FILE: &str = "legion.json";
const TICK: Duration = Duration::from_secs(10);
const MAX_BACKOFF: Duration = Duration::from_secs(320);
/// Accounts checked per tick, so a large first pass doesn't flood the RPC.
const BATCH: usize = 200;
const CONCURRENCY: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Rank {
    Initiate,
    Ascendant,
    Vanguard,
}

impl Rank {
    fn parse(name: &str) -> Option<Self> {
        match name {
            "initiate" => Some(Self::Initiate),
            "ascendant" => Some(Self::Ascendant),
            "vanguard" => Some(Self::Vanguard),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Settings {
    /// Each rank's SBT contract.
    pub contracts: Vec<(Rank, String)>,
    pub refresh: Duration,
}

impl Settings {
    /// `LEGION_CONTRACTS=initiate=initiate.nearlegion.near,ascendant=…,vanguard=…`; `None` when
    /// unset, which leaves the server as upstream near.social.
    pub fn from_env() -> Result<Option<Self>> {
        let Some(contracts) = std::env::var("LEGION_CONTRACTS").ok().filter(|v| !v.trim().is_empty()) else {
            return Ok(None);
        };
        let refresh = match std::env::var("LEGION_REFRESH_SECS").ok().filter(|v| !v.trim().is_empty()) {
            Some(v) => Duration::from_secs(v.parse().context("LEGION_REFRESH_SECS")?),
            None => Duration::from_secs(3600),
        };
        Ok(Some(Self { contracts: parse_contracts(&contracts)?, refresh }))
    }
}

fn parse_contracts(value: &str) -> Result<Vec<(Rank, String)>> {
    let mut contracts = vec![];
    for entry in value.split(',').map(str::trim).filter(|e| !e.is_empty()) {
        let Some((rank, contract)) = entry.split_once('=') else {
            bail!("LEGION_CONTRACTS entry `{entry}` is not rank=contract");
        };
        let Some(rank) = Rank::parse(rank.trim()) else {
            bail!("LEGION_CONTRACTS: unknown rank `{rank}` (initiate, ascendant or vanguard)");
        };
        let contract = contract.trim();
        if !crate::model::account_id::is_valid_account_id(contract) {
            bail!("LEGION_CONTRACTS: `{contract}` is not a valid account ID");
        }
        if contracts.iter().any(|(r, _)| *r == rank) {
            bail!("LEGION_CONTRACTS names {rank:?} twice");
        }
        contracts.push((rank, contract.to_string()));
    }
    if contracts.is_empty() {
        bail!("LEGION_CONTRACTS names no contracts");
    }
    Ok(contracts)
}

/// What the indexer knows about each account's membership.
#[derive(Default)]
pub struct Members {
    /// Members only, by rank.
    ranks: FxHashMap<Aid, Rank>,
    /// When each account was last checked (ms). An account not here hasn't been checked yet.
    checked: FxHashMap<Aid, u64>,
}

/// One account's last check, as the snapshot keeps it (by name: account IDs survive a rebuild
/// of the state, internal IDs don't).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Check {
    pub rank: Option<Rank>,
    pub checked_ms: u64,
}

impl State {
    /// Turns the Legion filter on: from now on only checked members are visible.
    pub fn enable_legion(&mut self) {
        self.legion.get_or_insert_with(Members::default);
    }

    /// The account's Legion rank; `None` for non-members, unchecked accounts, or with Legion off.
    pub fn rank(&self, aid: Aid) -> Option<Rank> {
        self.legion.as_ref()?.ranks.get(&aid).copied()
    }

    /// Whether Legion is on and the account isn't a known member.
    pub fn is_outside_legion(&self, aid: Aid) -> bool {
        self.legion.as_ref().is_some_and(|m| !m.ranks.contains_key(&aid))
    }

    /// Accounts due a check: never-checked ones first, then those checked before `stale_ms`.
    fn legion_due(&self, stale_ms: u64, limit: usize) -> Vec<(Aid, String)> {
        let Some(members) = &self.legion else { return vec![] };
        let unchecked = (0..self.accounts.len() as Aid).filter(|aid| !members.checked.contains_key(aid));
        let stale = (0..self.accounts.len() as Aid).filter(|aid| members.checked.get(aid).is_some_and(|&ms| ms < stale_ms));
        unchecked
            .chain(stale)
            .take(limit)
            .map(|aid| (aid, self.account(aid).name.to_string()))
            .collect()
    }

    fn record_check(&mut self, aid: Aid, check: Check) {
        let Some(members) = &mut self.legion else { return };
        match check.rank {
            Some(rank) => members.ranks.insert(aid, rank),
            None => members.ranks.remove(&aid),
        };
        members.checked.insert(aid, check.checked_ms);
    }

    /// Every check so far, by account ID.
    fn legion_snapshot(&self) -> FxHashMap<String, Check> {
        let Some(members) = &self.legion else { return FxHashMap::default() };
        members
            .checked
            .iter()
            .map(|(&aid, &checked_ms)| {
                (self.account(aid).name.to_string(), Check { rank: members.ranks.get(&aid).copied(), checked_ms })
            })
            .collect()
    }

    /// Restores a snapshot's checks for accounts the state already has; the rest are rechecked
    /// when they appear.
    fn restore_legion(&mut self, snapshot: FxHashMap<String, Check>) -> usize {
        let known: Vec<(Aid, Check)> =
            snapshot.into_iter().filter_map(|(name, check)| Some((self.aid(&name)?, check))).collect();
        let restored = known.len();
        for (aid, check) in known {
            self.record_check(aid, check);
        }
        restored
    }
}

/// The highest rank among the contracts that hold a token for the account.
fn highest(held: impl IntoIterator<Item = (Rank, bool)>) -> Option<Rank> {
    held.into_iter().filter(|&(_, holds)| holds).map(|(rank, _)| rank).max()
}

/// `nft_supply_for_owner`'s result: a count, as a JSON string (NEP-181).
fn parse_supply(response: &Value) -> Result<u64> {
    if let Some(error) = response.get("error").or_else(|| response["result"].get("error")) {
        bail!("RPC error: {error}");
    }
    let bytes: Vec<u8> =
        serde_json::from_value(response["result"]["result"].clone()).context("RPC result is not bytes")?;
    let supply: String = serde_json::from_slice(&bytes).context("nft_supply_for_owner is not a string")?;
    Ok(supply.parse()?)
}

struct Checker {
    client: reqwest::Client,
    rpc_url: String,
    bearer: Option<String>,
    contracts: Vec<(Rank, String)>,
}

impl Checker {
    async fn holds(&self, contract: &str, account_id: &str) -> Result<bool> {
        let args = serde_json::to_vec(&json!({ "account_id": account_id }))?;
        let mut request = self.client.post(&self.rpc_url);
        if let Some(token) = &self.bearer {
            request = request.bearer_auth(token);
        }
        let response: Value = request
            .json(&json!({
                "jsonrpc": "2.0",
                "id": PROJECT_ID,
                "method": "query",
                "params": {
                    "request_type": "call_function",
                    "finality": "final",
                    "account_id": contract,
                    "method_name": "nft_supply_for_owner",
                    "args_base64": BASE64.encode(args),
                }
            }))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(parse_supply(&response)? > 0)
    }

    /// The account's rank, or an error if any contract couldn't be asked: a failed check is
    /// retried, never read as "not a member".
    async fn rank(&self, account_id: &str) -> Result<Option<Rank>> {
        let mut held = vec![];
        for (rank, contract) in &self.contracts {
            held.push((*rank, self.holds(contract, account_id).await?));
        }
        Ok(highest(held))
    }
}

/// How long to wait before the next batch: one tick after a clean batch, twice the last wait
/// (up to `MAX_BACKOFF`) after one with failures.
fn next_delay(last: Duration, failed: bool) -> Duration {
    if failed {
        (last * 2).min(MAX_BACKOFF)
    } else {
        TICK
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn load_snapshot(path: &Path) -> Result<FxHashMap<String, Check>> {
    Ok(serde_json::from_slice(&std::fs::read(path)?)?)
}

fn save_snapshot(path: &Path, snapshot: &FxHashMap<String, Check>) -> Result<()> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(snapshot)?)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Turns the filter on and restores the last snapshot from `data_dir`. Call after the log is
/// replayed, so the snapshot's accounts exist.
pub fn start(state: &RwLock<State>, data_dir: &Path) {
    let mut s = state.write();
    s.enable_legion();
    let path = data_dir.join(SNAPSHOT_FILE);
    match load_snapshot(&path) {
        Ok(snapshot) => {
            let restored = s.restore_legion(snapshot);
            tracing::info!(target: PROJECT_ID, "Restored {restored} membership checks");
        }
        Err(e) if path.exists() => tracing::warn!(target: PROJECT_ID, "Can't read {}: {e}", path.display()),
        Err(_) => {}
    }
}

/// Checks due accounts forever, saving a snapshot after each batch.
pub async fn watch(settings: Settings, config: Arc<Config>, state: Arc<RwLock<State>>) {
    let checker = Checker {
        client: reqwest::Client::builder().timeout(Duration::from_secs(10)).build().expect("reqwest client"),
        rpc_url: config.rpc_url.clone(),
        bearer: config.auth_bearer_token.clone(),
        contracts: settings.contracts,
    };
    let path: PathBuf = config.data_dir.join(SNAPSHOT_FILE);
    let mut delay = TICK;
    loop {
        let started = now_ms();
        let due = state.read().legion_due(started.saturating_sub(settings.refresh.as_millis() as u64), BATCH);
        if due.is_empty() {
            tokio::time::sleep(TICK).await;
            continue;
        }
        let results: Vec<(Aid, String, Result<Option<Rank>>)> = stream::iter(due)
            .map(|(aid, name)| {
                let checker = &checker;
                async move {
                    let rank = checker.rank(&name).await;
                    (aid, name, rank)
                }
            })
            .buffer_unordered(CONCURRENCY)
            .collect()
            .await;
        let (mut checked, mut failed) = (0, 0);
        let snapshot = {
            let mut s = state.write();
            for (aid, name, rank) in results {
                match rank {
                    Ok(rank) => {
                        s.record_check(aid, Check { rank, checked_ms: started });
                        checked += 1;
                    }
                    Err(e) => {
                        tracing::warn!(target: PROJECT_ID, "Can't check {name}: {e:#}");
                        failed += 1;
                    }
                }
            }
            s.legion_snapshot()
        };
        if let Err(e) = save_snapshot(&path, &snapshot) {
            tracing::warn!(target: PROJECT_ID, "Can't save {}: {e:#}", path.display());
        }
        delay = next_delay(delay, failed > 0);
        tracing::info!(target: PROJECT_ID, "Checked {checked} accounts ({failed} failed); next batch in {delay:?}");
        tokio::time::sleep(delay).await;
    }
}

#[cfg(test)]
mod tests;
