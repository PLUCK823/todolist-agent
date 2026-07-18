#!/usr/bin/env python3
"""Assert that only the frontend may supply trusted client IP headers.

Run from the repository root.  This deliberately uses only Python's standard
library so it can be used in CI images that do not include jq.
"""

from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
AUTH_PROXY_NETWORK = "auth_proxy"
AUTH_PROXY_SUBNET = "172.30.10.0/29"
FRONTEND_PROXY_IP = "172.30.10.2"
BACKEND_PROXY_IP = "172.30.10.3"


def fail(message: str) -> None:
    raise AssertionError(message)


def service_network(service: dict, network: str) -> dict | None:
    networks = service.get("networks", {})
    if isinstance(networks, list):
        return {} if network in networks else None
    return networks.get(network)


def environment_value(service: dict, name: str) -> str | None:
    environment = service.get("environment", {})
    if isinstance(environment, dict):
        return environment.get(name)
    for item in environment:
        key, separator, value = item.partition("=")
        if key == name:
            return value if separator else None
    return None


def rendered_compose() -> dict:
    environment = os.environ.copy()
    environment.setdefault("AUTH_JWT_SECRET", "0123456789abcdef0123456789abcdef")
    result = subprocess.run(
        ["docker", "compose", "config", "--format", "json"],
        cwd=ROOT,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def main() -> int:
    compose = rendered_compose()
    network = compose.get("networks", {}).get(AUTH_PROXY_NETWORK)
    if not network or network.get("internal") is not True:
        fail("auth_proxy must exist and be an internal network")
    subnets = [
        config.get("subnet")
        for config in network.get("ipam", {}).get("config", [])
    ]
    if subnets != [AUTH_PROXY_SUBNET]:
        fail(f"auth_proxy subnet must be {AUTH_PROXY_SUBNET}, got {subnets}")

    services = compose["services"]
    frontend_network = service_network(services["frontend"], AUTH_PROXY_NETWORK)
    if not frontend_network or frontend_network.get("ipv4_address") != FRONTEND_PROXY_IP:
        fail(f"frontend must use {AUTH_PROXY_NETWORK} at {FRONTEND_PROXY_IP}")

    backend_network = service_network(services["backend"], AUTH_PROXY_NETWORK)
    if not backend_network or backend_network.get("ipv4_address") != BACKEND_PROXY_IP:
        fail(f"backend must use {AUTH_PROXY_NETWORK} at {BACKEND_PROXY_IP}")
    if "backend-proxy" not in backend_network.get("aliases", []):
        fail("backend must expose backend-proxy only on auth_proxy")

    if service_network(services["agent"], AUTH_PROXY_NETWORK) is not None:
        fail("agent must not join auth_proxy")

    trusted_proxy = environment_value(services["backend"], "AUTH_TRUSTED_PROXY_CIDRS")
    if trusted_proxy != f"{FRONTEND_PROXY_IP}/32":
        fail(f"backend must trust only {FRONTEND_PROXY_IP}/32, got {trusted_proxy!r}")

    nginx = (ROOT / "frontend" / "nginx.conf").read_text(encoding="utf-8")
    if "location /api/ {\n        proxy_pass http://backend-proxy:8080;" not in nginx:
        fail("generic /api/ traffic must use backend-proxy on auth_proxy")

    print("compose security verification passed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
        print(f"compose security verification failed: {error}", file=sys.stderr)
        raise SystemExit(1)
