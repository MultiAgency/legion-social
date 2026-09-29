# Build from the repository root: docker build -f server/Dockerfile .
FROM rust:1-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY server ./server
COPY docs ./docs
COPY SKILL.md ./SKILL.md
RUN cargo build --release -p near-social-server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/near-social-server /usr/local/bin/near-social-server
ENV BIND=0.0.0.0 PORT=3040 DATA_DIR=/data
VOLUME /data
EXPOSE 3040
CMD ["near-social-server"]
