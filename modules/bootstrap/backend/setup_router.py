from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from modules.bootstrap.backend.setup_runtime import INSTALL_SCRIPT, UNINSTALL_SCRIPT, runtime


router = APIRouter(prefix="/setup", tags=["setup"])


class InstallRequest(BaseModel):
    install_mode: Literal["dev", "prod"]
    install_dir: str = Field(default="~/.knotwork")
    owner_name: str
    owner_email: str
    owner_password: str = ""
    domain: str = "localhost"
    distribution_choice: Literal["chimera", "manticore", "both"] = "chimera"
    storage_adapter: str = "local_fs"
    local_fs_root: str = "/app/data/knowledge"
    default_model: str = "human"
    jwt_secret: str = ""
    backend_port: int = 8000
    frontend_port: int = 3000
    frontend_url: str = "http://localhost:3000"
    backend_url: str = "http://localhost:8000"
    restore_backup_path: str = ""
    openclaw_in_docker: bool = True
    plugin_url: str = "https://lab.crea8r.xyz/kw-plugin/latest"
    resend_api: str = ""
    email_from: str = ""


class UninstallRequest(BaseModel):
    install_dir: str = Field(default="~/.knotwork")
    skip_backup: bool = False
    backup_dir: str = "../knotwork-uninstall-backups"
    assume_yes: bool = False


class DeleteBackupsRequest(BaseModel):
    paths: list[str] = Field(default_factory=list)


def _uninstall_answers(data: UninstallRequest) -> str | None:
    if data.assume_yes:
        return None

    lines = ["no" if data.skip_backup else "yes", "yes"]
    return "\n".join(lines) + "\n"


def _install_answers(data: InstallRequest) -> str:
    lines: list[str] = [
        data.install_dir,
        data.owner_name,
        data.owner_email,
        data.owner_password,
    ]
    if data.owner_password:
        lines.append(data.owner_password)

    if data.install_mode == "prod":
        lines.extend(
            [
                data.domain,
                data.distribution_choice,
                data.storage_adapter,
                data.local_fs_root,
                data.default_model,
                data.restore_backup_path,
                data.jwt_secret,
                str(data.backend_port),
                str(data.frontend_port),
            ]
        )
        if data.domain == "localhost":
            lines.extend(
                [
                    data.frontend_url,
                    "yes" if data.openclaw_in_docker else "no",
                    data.plugin_url,
                    data.resend_api,
                    data.email_from,
                ]
            )
        else:
            lines.extend(
                [
                    data.frontend_url,
                    data.backend_url,
                    data.plugin_url,
                    data.resend_api,
                    data.email_from,
                ]
            )
    else:
        lines.extend(
            [
                data.distribution_choice,
                data.storage_adapter,
                data.local_fs_root,
                data.default_model,
                data.restore_backup_path,
                data.jwt_secret,
                str(data.backend_port),
                str(data.frontend_port),
                data.frontend_url,
                "yes" if data.openclaw_in_docker else "no",
                data.plugin_url,
                data.resend_api,
                data.email_from,
            ]
        )

    return "\n".join(lines) + "\n"


@router.get("/status")
async def setup_status():
    return await runtime.status()


@router.get("/detect-install")
async def setup_detect_install(install_dir: str = "~/.knotwork"):
    return runtime.probe_installation(install_dir)


@router.get("/backups")
async def setup_backups(backup_dir: str = "../knotwork-uninstall-backups"):
    return {"backups": runtime.list_backups(backup_dir)}


@router.post("/backups/delete")
async def setup_delete_backups(payload: DeleteBackupsRequest):
    return runtime.delete_backups(payload.paths)


@router.post("/install")
async def setup_install(payload: InstallRequest):
    command = [str(INSTALL_SCRIPT)]
    if payload.install_mode == "dev":
        command.append("--dev")
    try:
        return await runtime.start_install(command=command, answers=_install_answers(payload))
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/uninstall")
async def setup_uninstall(payload: UninstallRequest):
    command = [
        str(UNINSTALL_SCRIPT),
        "--install-dir",
        payload.install_dir,
    ]
    if payload.skip_backup:
        command.append("--skip-backup")
    else:
        command.extend(["--backup-dir", payload.backup_dir])
    if payload.assume_yes:
        command.append("--yes")
    try:
        return await runtime.start_uninstall(command=command, answers=_uninstall_answers(payload))
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/cancel")
async def setup_cancel():
    return await runtime.cancel()
