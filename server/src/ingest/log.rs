//! Append-only event log (`kv.jsonl`, one `LogBlock` per line) plus a checkpoint file.
//!
//! The checkpoint records the last processed block and the log length at that point. On boot
//! the log is truncated to that length (dropping a torn tail), replayed, and indexing resumes
//! from the next block.

use crate::ingest::fastdata::LogBlock;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Checkpoint {
    pub block_height: u64,
    pub log_len: u64,
}

pub struct EventLog {
    dir: PathBuf,
    file: File,
    len: u64,
}

impl EventLog {
    fn log_path(dir: &Path) -> PathBuf {
        dir.join("kv.jsonl")
    }

    fn checkpoint_path(dir: &Path) -> PathBuf {
        dir.join("checkpoint.json")
    }

    pub fn read_checkpoint(dir: &Path) -> Result<Option<Checkpoint>> {
        let path = Self::checkpoint_path(dir);
        if !path.exists() {
            return Ok(None);
        }
        let data = fs::read(&path).with_context(|| format!("reading {}", path.display()))?;
        Ok(Some(serde_json::from_slice(&data).context("parsing checkpoint")?))
    }

    /// Opens the log, truncating it to the checkpoint, and replays every block through `apply`.
    /// Returns the log and the last block height seen (from the checkpoint or the log).
    pub fn open_and_replay(dir: &Path, mut apply: impl FnMut(LogBlock)) -> Result<(Self, Option<u64>)> {
        fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
        let checkpoint = Self::read_checkpoint(dir)?;
        let path = Self::log_path(dir);
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .append(true)
            .open(&path)
            .with_context(|| format!("opening {}", path.display()))?;
        let file_len = file.metadata()?.len();
        let valid_len = match checkpoint {
            Some(c) if c.log_len > file_len => {
                anyhow::bail!(
                    "{} is shorter ({file_len}) than the checkpoint says ({}); refusing to start",
                    path.display(),
                    c.log_len
                )
            }
            Some(c) => c.log_len,
            // No checkpoint: keep every complete line.
            None => file_len,
        };

        let mut last_block = checkpoint.map(|c| c.block_height);
        let mut consumed = 0u64;
        let mut reader = BufReader::new(File::open(&path)?);
        let mut line = String::new();
        let mut blocks = 0u64;
        while consumed < valid_len {
            line.clear();
            let n = reader.read_line(&mut line)? as u64;
            if n == 0 || !line.ends_with('\n') || consumed + n > valid_len {
                break; // torn tail
            }
            let block: LogBlock = serde_json::from_str(&line)
                .with_context(|| format!("parsing log line at byte {consumed}"))?;
            last_block = Some(last_block.map_or(block.b, |h: u64| h.max(block.b)));
            apply(block);
            consumed += n;
            blocks += 1;
        }
        if consumed < file_len {
            tracing::warn!(target: "log", "Truncating {} from {file_len} to {consumed} bytes", path.display());
            file.set_len(consumed)?;
        }
        tracing::info!(target: "log", "Replayed {blocks} blocks ({consumed} bytes)");
        Ok((
            Self {
                dir: dir.to_path_buf(),
                file,
                len: consumed,
            },
            last_block,
        ))
    }

    /// Appends a block and fsyncs it.
    pub fn append(&mut self, block: &LogBlock) -> Result<()> {
        let mut line = serde_json::to_vec(block)?;
        line.push(b'\n');
        self.file.write_all(&line)?;
        self.file.sync_data()?;
        self.len += line.len() as u64;
        Ok(())
    }

    /// Records that every block up to `block_height` has been processed.
    pub fn checkpoint(&self, block_height: u64) -> Result<()> {
        let tmp = self.dir.join("checkpoint.json.tmp");
        fs::write(
            &tmp,
            serde_json::to_vec(&Checkpoint {
                block_height,
                log_len: self.len,
            })?,
        )?;
        fs::rename(&tmp, Self::checkpoint_path(&self.dir))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ingest::fastdata::{ActionStatus, LogAction};

    fn block(b: u64) -> LogBlock {
        LogBlock {
            b,
            t: b * 1_000_000_000,
            a: vec![LogAction {
                o: 1,
                tx: Some(format!("tx{b}")),
                p: "a.near".into(),
                s: ActionStatus::Ok,
                r: vec![("post/1".into(), r#"{"text":"x"}"#.into())],
                d: vec![],
                c: None,
            }],
        }
    }

    #[test]
    fn replay_truncates_torn_tail_and_uncheckpointed_blocks() {
        let dir = std::env::temp_dir().join(format!("nsk-log-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        {
            let (mut log, last) = EventLog::open_and_replay(&dir, |_| {}).unwrap();
            assert_eq!(last, None);
            log.append(&block(10)).unwrap();
            log.checkpoint(10).unwrap();
            log.append(&block(11)).unwrap(); // not checkpointed
            log.file.write_all(b"{\"b\":12,").unwrap(); // torn
        }
        let mut seen = vec![];
        let (log, last) = EventLog::open_and_replay(&dir, |b| seen.push(b.b)).unwrap();
        assert_eq!(seen, vec![10]);
        assert_eq!(last, Some(10));
        assert_eq!(fs::metadata(dir.join("kv.jsonl")).unwrap().len(), log.len);
        fs::remove_dir_all(&dir).unwrap();
    }
}
