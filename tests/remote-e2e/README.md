# Remote gRPC E2E (DNS / Failover)

End-to-end tests for Java-aligned gRPC backend failover. Uses
[mock-collector](https://github.com/apache/skywalking-agent-test-tool) (not real OAP).

## Cases

| Directory | Validates |
|-----------|-----------|
| `static-failover/` | Phase A — comma-separated backends, primary stop, secondary receives traces |
| `dns-re-resolve/` | Phase B — `oap.test` multi-IP DNS expand + `selectedIdx` rotation failover (Java parity) |

## Host port allocation (Phase A / B disjoint)

Phase A and Phase B bind **different host ports** so they can run on one machine without conflict.
CI runs them in parallel matrix jobs; locally use `--runInBand` or `run-all.sh`.

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
| TLS gRPC (`SW_AGENT_SECURE`) | `TLSChannelBuilder`, `AgentConfig.dns` | mock-collector has no TLS; use `scripts/tls-scheme-a-test/` against real OAP |

## Run locally

Requires Node >= 20, Docker, and image pull access.

```bash
# 1) WSL native docker: configure docker.io mirrors
sudo bash /mnt/c/agent/scripts/setup-docker-mirror-wsl.sh

# 2) Pre-pull e2e images (docker.io + ghcr.io mirrors)
bash /mnt/c/agent/scripts/preload-e2e-images.sh

# 3) Run one phase
export TESTCONTAINERS_RYUK_DISABLED=true
npm i
npm run test tests/remote-e2e/static-failover/ --runInBand
npm run test tests/remote-e2e/dns-re-resolve/ --runInBand

# 4) Run Phase A + B sequentially (disjoint ports)
bash tests/remote-e2e/run-all.sh
```

## Agent env (set in docker-compose)

| Variable | Phase A | Phase B |
|----------|---------|---------|
| `SW_AGENT_COLLECTOR_BACKEND_SERVICES` | `collector-a:19876,collector-b:19876` | `oap.test:19876` (2 A records in entrypoint) |
| `SW_AGENT_IS_RESOLVE_DNS_PERIODICALLY` | — | `true` |
| `SW_AGENT_GRPC_CHANNEL_CHECK_INTERVAL` | `2` | `1` |
| `SW_AGENT_SECURE` | `false` (insecure; TLS covered in unit + scheme-a) | same |

## DNS + TLS combined (OAP E2E)

Mock-collector E2E uses **insecure gRPC** only. Full **TLS + periodic DNS re-resolve** is covered in the OAP fork:

- Case: `test/e2e-v2/cases/nodejs/ssl-dns/` (branch `feature/nodejs-agent-tls-e2e`)
- CI job: **Agent NodeJS SSL DNS**
- Agent uses mounted CA at `/app/ca/ca.crt`, `SW_AGENT_IS_RESOLVE_DNS_PERIODICALLY=true`, `SW_AGENT_SSL_TARGET_NAME_OVERRIDE=oap`, hostname `oap.test:11800` with `/etc/hosts` repoint to simulate DNS recovery under TLS.
