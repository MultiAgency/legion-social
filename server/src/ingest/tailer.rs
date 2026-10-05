//! Tails final blocks from neardata and feeds `__fastdata_kv` writes to the social account into
//! the event log and the state. The loop mirrors fastdata-indexer's main-indexer.

use crate::config::Config;
use crate::ingest::fastdata::{compute_order_id, parse_action, parse_fastfs_header, FastfsHeader, LogBlock};
use crate::state::BlockEffects;
use crate::ingest::log::EventLog;
use crate::state::State;
use fastnear_neardata_fetcher::fetcher;
use fastnear_primitives::near_primitives::views::{ActionView, ReceiptEnumView};
use parking_lot::RwLock;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{broadcast, mpsc};

const PROJECT_ID: &str = "tailer";
const KV_METHOD: &str = "__fastdata_kv";
const FASTFS_METHOD: &str = "__fastdata_fastfs";

struct Upload {
    order_id: u64,
    tx: Option<String>,
    predecessor: String,
    header: Option<FastfsHeader>,
}

/// Progress of the tailer (read by `/v1/status` without locking the state).
#[derive(Default)]
pub struct Progress {
    pub last_block_height: AtomicU64,
    pub last_block_ms: AtomicU64,
}

pub async fn resolve_latest_block(config: &Config) -> anyhow::Result<u64> {
    let client = reqwest::Client::new();
    let block = fetcher::fetch_last_block(&client, config.chain_id)
        .await
        .ok_or_else(|| anyhow::anyhow!("can't fetch the last block from neardata"))?;
    Ok(block.block.header.height)
}

#[allow(clippy::too_many_arguments)]
pub async fn run(
    config: Arc<Config>,
    state: Arc<RwLock<State>>,
    mut log: EventLog,
    start_block_height: u64,
    progress: Arc<Progress>,
    events: broadcast::Sender<Arc<str>>,
    is_running: Arc<AtomicBool>,
) -> anyhow::Result<()> {
    let mut fetcher_config = fetcher::FetcherConfigBuilder::new()
        .start_block_height(start_block_height)
        .num_threads(config.num_threads)
        .chain_id(config.chain_id)
        .user_agent(format!("near-social-server/{}", env!("CARGO_PKG_VERSION")));
    if let Some(token) = config.auth_bearer_token.clone() {
        fetcher_config = fetcher_config.auth_bearer_token(token);
    }
    tracing::info!(target: PROJECT_ID,
        "Tailing {} from block {start_block_height} for receiver `{}` (auth token: {})",
        config.chain_id, config.social_account_id, config.auth_bearer_token.is_some());

    let (sender, mut receiver) = mpsc::channel((config.num_threads * 10) as usize);
    tokio::spawn(fetcher::start_fetcher(fetcher_config.build(), sender, is_running.clone()));

    let mut last_checkpoint = Instant::now();
    let mut last_height = start_block_height.saturating_sub(1);
    while let Some(block) = receiver.recv().await {
        let height = block.block.header.height;
        let timestamp_ns = block.block.header.timestamp;
        let mut actions = vec![];
        let mut uploads: Vec<Upload> = vec![];
        for shard in block.shards {
            let shard_id: u64 = shard.shard_id.into();
            // Enumerate every outcome (not just ours) so order_id matches FastData's.
            for (receipt_index, outcome) in shard.receipt_execution_outcomes.into_iter().enumerate() {
                let receipt = outcome.receipt;
                // Any other receiver is a channel (docs/LEGION.md §3).
                let channel = (receipt.receiver_id.as_str() != config.social_account_id)
                    .then(|| receipt.receiver_id.to_string());
                let ReceiptEnumView::Action { actions: receipt_actions, .. } = receipt.receipt else {
                    continue;
                };
                for (action_index, action) in receipt_actions.into_iter().enumerate() {
                    if let ActionView::FunctionCall { method_name, args, .. } = action {
                        let order_id = compute_order_id(shard_id, receipt_index as u64, action_index as u64);
                        if method_name == KV_METHOD {
                            let action = parse_action(
                                order_id,
                                outcome.tx_hash.map(|h| h.to_string()),
                                receipt.predecessor_id.to_string(),
                                &args,
                            );
                            match &channel {
                                None => actions.push(action),
                                Some(c) => actions.extend(crate::channels::channel_action(action, c)),
                            }
                        } else if method_name == FASTFS_METHOD && channel.is_none() {
                            uploads.push(Upload {
                                order_id,
                                tx: outcome.tx_hash.map(|h| h.to_string()),
                                predecessor: receipt.predecessor_id.to_string(),
                                header: parse_fastfs_header(&args),
                            });
                        }
                    }
                }
            }
        }

        last_height = height;
        progress.last_block_height.store(height, Ordering::Relaxed);
        progress.last_block_ms.store(timestamp_ns / 1_000_000, Ordering::Relaxed);

        let mut effects: Option<BlockEffects> = None;
        if !actions.is_empty() {
            actions.sort_by_key(|a| a.o);
            let block = LogBlock {
                b: height,
                t: timestamp_ns,
                a: actions,
            };
            // Persist first, then apply: a crash in between replays the block on boot.
            log.append(&block)?;
            log.checkpoint(height)?;
            last_checkpoint = Instant::now();
            let fx = state.write().apply_block(&block);
            tracing::info!(target: PROJECT_ID, "Block {height}: {} actions, {} txs",
                block.a.len(), fx.tx_hashes.len());
            effects = Some(fx);
        } else if last_checkpoint.elapsed() >= config.block_update_interval {
            log.checkpoint(height)?;
            last_checkpoint = Instant::now();
            tracing::debug!(target: PROJECT_ID, "Checkpoint at block {height}");
        }
        if !uploads.is_empty() {
            uploads.sort_by_key(|u| u.order_id);
            let block_ms = timestamp_ns / 1_000_000;
            let fx = effects.get_or_insert_with(|| BlockEffects {
                block_height: height,
                block_ts: block_ms,
                ..Default::default()
            });
            let mut s = state.write();
            for upload in uploads {
                if let Some(tx) = &upload.tx {
                    s.record_fastfs(tx, height, block_ms, &upload.predecessor, upload.header);
                    if !fx.tx_hashes.contains(tx) {
                        fx.tx_hashes.push(tx.clone());
                    }
                }
            }
            tracing::info!(target: PROJECT_ID, "Block {height}: FastFS uploads confirmed");
        }
        if let Some(fx) = effects {
            let _ = events.send(serde_json::to_string(&fx)?.into());
        }

        if !is_running.load(Ordering::SeqCst) {
            break;
        }
    }
    log.checkpoint(last_height)?;
    tracing::info!(target: PROJECT_ID, "Stopped at block {last_height}");
    Ok(())
}
