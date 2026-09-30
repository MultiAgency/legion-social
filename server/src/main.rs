use actix_cors::Cors;
use actix_web::{middleware, web, App, HttpServer};
use anyhow::{bail, Context, Result};
use dotenv::dotenv;
use near_social_server::api::{self, AppState, Caches, Docs};
use near_social_server::config::{Config, StartBlock};
use near_social_server::ingest::log::EventLog;
use near_social_server::ingest::tailer::{self, Progress};
use near_social_server::legacy::LegacyClient;
use near_social_server::model::account_id::is_valid_account_id;
use near_social_server::state::State;
use near_social_server::unfurl::Unfurler;
use parking_lot::RwLock;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};
use tokio::sync::broadcast;

const PROJECT_ID: &str = "near-social-server";

fn load_denylist(path: &Path) -> Result<Vec<String>> {
    Ok(std::fs::read_to_string(path)?
        .lines()
        .map(|l| l.split('#').next().unwrap_or("").trim().to_string())
        .filter(|l| is_valid_account_id(l))
        .collect())
}

/// Reloads the denylist whenever the file changes.
async fn watch_denylist(path: std::path::PathBuf, state: Arc<RwLock<State>>) {
    let mut last_modified: Option<SystemTime> = None;
    let mut interval = tokio::time::interval(Duration::from_secs(30));
    loop {
        interval.tick().await;
        let modified = std::fs::metadata(&path).and_then(|m| m.modified()).ok();
        if modified.is_none() || modified == last_modified {
            continue;
        }
        match load_denylist(&path) {
            Ok(names) => {
                tracing::info!(target: PROJECT_ID, "Denylist: {} accounts", names.len());
                state.write().set_hidden(&names);
                last_modified = modified;
            }
            Err(e) => tracing::warn!(target: PROJECT_ID, "Can't read denylist {}: {e}", path.display()),
        }
    }
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("installing SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = term.recv() => {}
        }
    }
    #[cfg(not(unix))]
    let _ = tokio::signal::ctrl_c().await;
}

#[tokio::main]
async fn main() -> Result<()> {
    dotenv().ok();
    init_tracing();

    let config = Arc::new(Config::from_env()?);
    let state = Arc::new(RwLock::new(State::new()));

    let started = Instant::now();
    let (log, last_block) = {
        let mut s = state.write();
        EventLog::open_and_replay(&config.data_dir, |block| {
            s.apply_block(&block);
        })?
    };
    {
        let s = state.read();
        tracing::info!(target: PROJECT_ID,
            "State ready in {:?}: {} accounts, {} posts, {} likes, {} follows",
            started.elapsed(), s.counts.accounts, s.counts.posts, s.counts.likes, s.counts.follows);
    }

    let progress = Arc::new(Progress::default());
    if let Some(height) = last_block {
        progress.last_block_height.store(height, Ordering::Relaxed);
        progress.last_block_ms.store(state.read().last_block_ms, Ordering::Relaxed);
    }

    let (events, _) = broadcast::channel::<Arc<str>>(256);
    let is_running = Arc::new(AtomicBool::new(true));

    let tailer_handle = if config.indexer_enabled {
        let start = match (last_block, config.start_block) {
            (Some(height), _) => height + 1,
            (None, Some(StartBlock::Height(height))) => height,
            (None, Some(StartBlock::Latest)) => tailer::resolve_latest_block(&config).await?,
            (None, None) => bail!(
                "START_BLOCK_HEIGHT is required on first start (a block height, or `latest` for development)"
            ),
        };
        Some(tokio::spawn(tailer::run(
            config.clone(),
            state.clone(),
            log,
            start,
            progress.clone(),
            events.clone(),
            is_running.clone(),
        )))
    } else {
        tracing::warn!(target: PROJECT_ID, "INDEXER=off: serving the replayed log only");
        None
    };

    if let Some(path) = config.denylist_path.clone() {
        tokio::spawn(watch_denylist(path, state.clone()));
    }

    let base = &config.public_url;
    let docs = web::Data::new(AppState {
        state: state.clone(),
        config: config.clone(),
        progress,
        events,
        legacy: Arc::new(LegacyClient::new(config.clone())?),
        unfurl: Unfurler::new(config.clone())?,
        docs: Docs {
            skill: include_str!("../../SKILL.md").replace("{{HOSTNAME}}", base),
            standard: include_str!("../../docs/STANDARD.md").replace("{{HOSTNAME}}", base),
            api: include_str!("../../docs/API.md").replace("{{HOSTNAME}}", base),
        },
        caches: Caches::default(),
    });

    tracing::info!(target: PROJECT_ID, "Listening on {}:{}", config.bind, config.port);
    let server = HttpServer::new(move || {
        let cors = Cors::default()
            .allow_any_origin()
            .allowed_methods(vec!["GET", "POST"])
            .allowed_headers(vec![
                actix_web::http::header::CONTENT_TYPE,
                actix_web::http::header::ACCEPT,
            ])
            .max_age(3600);
        App::new()
            .app_data(docs.clone())
            .app_data(web::JsonConfig::default().limit(64 * 1024))
            .wrap(cors)
            .wrap(middleware::Compress::default())
            .wrap(middleware::Logger::new("%{r}a \"%r\"\t%s %b \"%{User-Agent}i\" %T"))
            .wrap(tracing_actix_web::TracingLogger::default())
            .configure(api::routes)
    })
    .disable_signals()
    .bind((config.bind.as_str(), config.port))
    .with_context(|| format!("binding {}:{}", config.bind, config.port))?
    .run();

    let server_handle = server.handle();
    let running = is_running.clone();
    tokio::spawn(async move {
        shutdown_signal().await;
        tracing::info!(target: PROJECT_ID, "Shutting down...");
        running.store(false, Ordering::SeqCst);
        server_handle.stop(true).await;
    });

    let mut server_task = tokio::spawn(server);
    match tailer_handle {
        Some(mut tailer) => {
            tokio::select! {
                result = &mut tailer => {
                    // The tailer only returns on shutdown or on a fatal error.
                    let failed = match result {
                        Ok(Ok(())) => false,
                        Ok(Err(e)) => { tracing::error!(target: PROJECT_ID, "Indexer failed: {e:#}"); true }
                        Err(e) => { tracing::error!(target: PROJECT_ID, "Indexer panicked: {e}"); true }
                    };
                    if failed || is_running.swap(false, Ordering::SeqCst) {
                        bail!("indexer stopped unexpectedly");
                    }
                    server_task.await??;
                }
                result = &mut server_task => {
                    is_running.store(false, Ordering::SeqCst);
                    // Let the tailer write its final checkpoint.
                    match tokio::time::timeout(Duration::from_secs(20), tailer).await {
                        Ok(Ok(Err(e))) => tracing::error!(target: PROJECT_ID, "Indexer failed: {e:#}"),
                        Err(_) => tracing::warn!(target: PROJECT_ID, "Indexer didn't stop in time"),
                        _ => {}
                    }
                    result??;
                }
            }
        }
        None => server_task.await??,
    }
    tracing::info!(target: PROJECT_ID, "Bye");
    Ok(())
}

fn init_tracing() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                "info,neardata-fetcher=info,actix_web=info,tracing_actix_web=warn".into()
            }),
        )
        .init();
}
