# Remote gRPC E2E (DNS / Failover)

End-to-end tests for Java-aligned gRPC backend failover. Uses
[mock-collector](https://github.com/apache/skywalking-agent-test-tool) (not real OAP).

## Cases

| Directory | Validates |
|-----------|-----------|
| `static-failover/` | Phase A — comma-separated backends, primary stop, secondary receives traces |
| `dns-re-resolve/` | Phase B — `oap.test` multi-IP DNS expand + `selectedIdx` rotation failover (Java parity) |
| `common/server.ts` | Shared agent HTTP stub (`/ping`, `/flush`) used by both phases |
| `support/helpers.ts` | Shared Testcontainers helpers (image build, compose bootstrap, assertions) |

## Host port allocation (Phase A / B disjoint)

Phase A and Phase B bind **different host ports** so they can run on one machine without conflict.
GitHub Actions job `TestRemoteE2E` runs both cases on Node **22** in parallel (disjoint ports). Locally use `--runInBand` or `run-all.sh`.

| Role | Phase A | Phase B |
|------|---------|---------|
| Agent HTTP (`/ping`, `/flush`) | `5010` | `5020` |
| collector-a HTTP (`/receiveData`) | `12810` | `12820` |
| collector-b HTTP (`/receiveData`) | `12811` | `12821` |
| gRPC (in compose network) | `19876` | `19876` |

Reserved / avoid: `5000`, `12800`, `12801` (local nodedev OAP/mock).

## Coverage matrix (unit vs E2E)

| Scenario | Unit (`tests/remote/`) | E2E (this dir) |
|----------|------------------------|----------------|
| Static multi-address failover | `GRPCChannelManager` | Phase A |
| DNS multi-IP expand + selectedIdx failover | `GRPCChannelManager`, `BackendAddressResolver` | Phase B |
| Multi hostname / multi IP / IPv6-only DNS | `BackendAddressResolver` | — |
| DNS all-fail then recovery | `GRPCChannelManager` | — |
| TLS gRPC (`SW_AGENT_FORCE_TLS`, `SW_AGENT_SSL_TRUSTED_CA_PATH`) | `TLSChannelBuilder`, `AgentConfig.tls` | mock-collector has no TLS; see OAP `nodejs/ssl-dns` case |

## Run locally

Requires Node >= 20, Docker, and image pull access to `docker.io` / `ghcr.io`.

```bash
export TESTCONTAINERS_RYUK_DISABLED=true
npm i

# Optional: China npm mirror for cold Docker agent image build
export E2E_NPM_REGISTRY=https://registry.npmmirror.com

# Run one phase
npm run test tests/remote-e2e/static-failover/ --runInBand
npm run test tests/remote-e2e/dns-re-resolve/ --runInBand

# Run Phase A + B sequentially (disjoint ports)
bash tests/remote-e2e/run-all.sh
```

The first run builds `skywalking-nodejs-e2e-agent:22` from `tests/plugins/common/Dockerfile.agent` if missing.

## Agent env (set in docker-compose)

| Variable | Phase A | Phase B |
|----------|---------|---------|
| `SW_AGENT_COLLECTOR_BACKEND_SERVICES` | `collector-a:19876,collector-b:19876` | `oap.test:19876` (2 A records in entrypoint) |
| `SW_AGENT_IS_RESOLVE_DNS_PERIODICALLY` | — | `true` |
| `SW_AGENT_GRPC_CHANNEL_CHECK_INTERVAL` | `2` | `1` |
| `SW_AGENT_FORCE_RECONNECTION_PERIOD` | `1` | `1` |
| `SW_AGENT_RUNTIME_METRICS_REPORTER_ACTIVE` | `false` | `false` |
| TLS | not set (insecure gRPC; see unit tests + OAP ssl-dns) | same |

## DNS + TLS combined (OAP E2E)

Mock-collector E2E uses **insecure gRPC** only. Full **TLS + periodic DNS re-resolve** is covered in the OAP repo:

- Case: `test/e2e-v2/cases/nodejs/ssl-dns/` (OAP repo)
- CI job: **Agent NodeJS SSL DNS**
- Agent env: `SW_AGENT_FORCE_TLS=true`, `SW_AGENT_SSL_TRUSTED_CA_PATH=/app/certs/server.crt`, `SW_AGENT_IS_RESOLVE_DNS_PERIODICALLY=true`, backend `oap:11800`
- `entrypoint.sh` seeds `/etc/hosts` for hostname `oap`; `repoint-dns.sh good|bad` toggles `oap` to simulate DNS failure and recovery under TLS (cert CN `oap`)
