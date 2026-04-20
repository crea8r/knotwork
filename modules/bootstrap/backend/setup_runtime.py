from __future__ import annotations

import asyncio
import json
import os
import subprocess
import zipfile
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from os.path import expanduser


REPO_ROOT = Path(__file__).resolve().parents[3]
INSTALL_SCRIPT = REPO_ROOT / "scripts" / "install.sh"
UNINSTALL_SCRIPT = REPO_ROOT / "scripts" / "uninstall.sh"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class SetupRunState:
    operation: str
    started_at: str = field(default_factory=_utc_now)
    finished_at: str | None = None
    status: str = "running"
    exit_code: int | None = None
    logs: deque[str] = field(default_factory=lambda: deque(maxlen=600))
    process: asyncio.subprocess.Process | None = None

    def append(self, line: str) -> None:
        self.logs.append(line.rstrip("\n"))


class SetupRuntime:
    def __init__(self) -> None:
        self._current: SetupRunState | None = None
        self._lock = asyncio.Lock()

    def _detect_installation(self, root_dir: Path) -> tuple[bool, list[str], dict]:
        manifest_path = root_dir / ".knotwork-install.json"
        env_path = root_dir / ".env"
        data_path = root_dir / "data"
        logs_path = root_dir / "logs"
        markers: list[str] = []
        metadata: dict = {
            "runtime_profile": None,
            "distribution_code": None,
            "distribution_label": None,
            "frontend_surfaces": [],
        }

        if env_path.exists():
            markers.append(".env")
        if data_path.exists():
            markers.append("data/")
        if logs_path.exists():
            markers.append("logs/")

        compose_project_name = ""
        network_name = ""
        if manifest_path.exists():
            try:
                manifest = json.loads(manifest_path.read_text())
                compose_project_name = str(manifest.get("compose_project_name", "")).strip()
                network_name = str(manifest.get("network_name", "")).strip()
                runtime_profile = str(manifest.get("runtime_profile", "")).strip()
                distribution_code = str(manifest.get("distribution_code", "")).strip()
                distribution_label = str(manifest.get("distribution_label", "")).strip()
                install_mode = str(manifest.get("install_mode", "")).strip()
                frontend_surfaces = manifest.get("frontend_surfaces", [])
                if runtime_profile:
                    metadata["runtime_profile"] = runtime_profile
                elif install_mode == "public":
                    metadata["runtime_profile"] = "prod"
                elif install_mode == "localhost":
                    metadata["runtime_profile"] = "local"
                if distribution_code:
                    metadata["distribution_code"] = distribution_code
                if distribution_label:
                    metadata["distribution_label"] = distribution_label
                if isinstance(frontend_surfaces, list):
                    metadata["frontend_surfaces"] = [
                        surface for surface in frontend_surfaces
                        if isinstance(surface, dict)
                    ]
            except Exception:
                markers.append("install-manifest (unreadable)")

        if compose_project_name:
            try:
                containers = subprocess.run(
                    ["docker", "ps", "-a", "--format", "{{.Names}}"],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                container_names = [name.strip() for name in containers.stdout.splitlines() if name.strip()]
                if any(
                    name == compose_project_name
                    or name.startswith(f"{compose_project_name}-")
                    or name.startswith(f"{compose_project_name}_")
                    for name in container_names
                ):
                    markers.append(f"docker-containers:{compose_project_name}")

                volumes = subprocess.run(
                    ["docker", "volume", "ls", "--format", "{{.Name}}"],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                volume_names = [name.strip() for name in volumes.stdout.splitlines() if name.strip()]
                if any(
                    name == compose_project_name
                    or name.startswith(f"{compose_project_name}-")
                    or name.startswith(f"{compose_project_name}_")
                    for name in volume_names
                ):
                    markers.append(f"docker-volumes:{compose_project_name}")
            except Exception:
                pass

        if network_name:
            try:
                network = subprocess.run(
                    ["docker", "network", "inspect", network_name],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                if network.returncode == 0:
                    markers.append(f"docker-network:{network_name}")
            except Exception:
                pass

        return bool(markers), markers, metadata

    def probe_installation(self, install_dir: str) -> dict:
        root_dir = Path(expanduser(install_dir)).resolve()
        installed, markers, metadata = self._detect_installation(root_dir)
        return {
            "install_dir": str(root_dir),
            "installed": installed,
            "install_markers": markers,
            "runtime_profile": metadata.get("runtime_profile"),
            "distribution_code": metadata.get("distribution_code"),
            "distribution_label": metadata.get("distribution_label"),
            "frontend_surfaces": metadata.get("frontend_surfaces", []),
        }

    def _build_status(self) -> dict:
        installed, install_markers, _metadata = self._detect_installation(REPO_ROOT)
        running = self._current is not None and self._current.status == "running"
        current = self._current
        return {
            "repo_root": str(REPO_ROOT),
            "installed": installed,
            "install_markers": install_markers,
            "running": running,
            "current": None
            if current is None
            else {
                "operation": current.operation,
                "status": current.status,
                "started_at": current.started_at,
                "finished_at": current.finished_at,
                "exit_code": current.exit_code,
                "logs": list(current.logs),
            },
        }

    async def status(self) -> dict:
        return self._build_status()

    def list_backups(self, backup_dir: str) -> list[dict]:
        root = Path(expanduser(backup_dir)).resolve()
        if not root.exists() or not root.is_dir():
            return []

        current_commit = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=False,
        ).stdout.strip()

        backups: list[dict] = []
        for path in sorted(root.glob("*.zip"), key=lambda item: item.stat().st_mtime, reverse=True):
            metadata: dict = {}
            stale = True
            reason = "Backup metadata is missing or unreadable."
            try:
                with zipfile.ZipFile(path) as zf:
                    with zf.open("manifest.json") as manifest_file:
                        metadata = json.loads(manifest_file.read().decode("utf-8"))
                backup_commit = str(metadata.get("knotwork_version", "")).strip()
                if backup_commit and current_commit and backup_commit == current_commit:
                    stale = False
                    reason = ""
                elif backup_commit:
                    reason = "Backup was created from a different Knotwork revision."
            except Exception:
                metadata = {}

            stat = path.stat()
            backups.append(
                {
                    "name": path.name,
                    "path": str(path),
                    "created_at": metadata.get("created_at_utc") or datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
                    "size_bytes": stat.st_size,
                    "stale": stale,
                    "stale_reason": reason,
                    "metadata": metadata,
                }
            )
        return backups

    def delete_backups(self, paths: list[str]) -> dict:
        deleted: list[str] = []
        errors: list[dict] = []
        for raw_path in paths:
            path = Path(expanduser(raw_path)).resolve()
            if path.suffix != ".zip":
                errors.append({"path": str(path), "error": "Only .zip backup files can be deleted."})
                continue
            try:
                path.unlink()
                deleted.append(str(path))
            except FileNotFoundError:
                deleted.append(str(path))
            except Exception as exc:
                errors.append({"path": str(path), "error": str(exc)})
        return {"deleted": deleted, "errors": errors}

    async def start_install(self, *, command: list[str], answers: str) -> dict:
        return await self._start(operation="install", command=command, stdin_payload=answers)

    async def start_uninstall(self, *, command: list[str], answers: str | None) -> dict:
        return await self._start(operation="uninstall", command=command, stdin_payload=answers)

    async def _start(self, *, operation: str, command: list[str], stdin_payload: str | None) -> dict:
        async with self._lock:
            if self._current is not None and self._current.status == "running":
                raise RuntimeError("A setup task is already running.")

            state = SetupRunState(operation=operation)
            state.append(f"$ {' '.join(command)}")
            self._current = state
            asyncio.create_task(self._run_process(state, command=command, stdin_payload=stdin_payload))
            return self._build_status()

    async def _run_process(self, state: SetupRunState, *, command: list[str], stdin_payload: str | None) -> None:
        env = os.environ.copy()
        if Path("/var/run/docker.sock").exists():
            env["DOCKER_HOST"] = "unix:///var/run/docker.sock"
            env["DOCKER_CONTEXT"] = ""
            env.setdefault("DOCKER_CONFIG", "/tmp/.docker")

        process = await asyncio.create_subprocess_exec(
            *command,
            cwd=str(REPO_ROOT),
            env=env,
            stdin=asyncio.subprocess.PIPE if stdin_payload is not None else None,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        state.process = process

        if stdin_payload is not None and process.stdin is not None:
            process.stdin.write(stdin_payload.encode())
            await process.stdin.drain()
            process.stdin.close()

        assert process.stdout is not None
        async for raw_line in process.stdout:
            state.append(raw_line.decode(errors="replace"))

        code = await process.wait()
        state.exit_code = code
        state.finished_at = _utc_now()
        state.status = "completed" if code == 0 else "failed"

    async def cancel(self) -> dict:
        async with self._lock:
            if self._current is None or self._current.status != "running" or self._current.process is None:
                return self._build_status()
            self._current.process.terminate()
            self._current.append("Cancellation requested.")
            return self._build_status()


runtime = SetupRuntime()
