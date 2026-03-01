"""SMTP email channel sender."""
from __future__ import annotations

import logging
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)


async def send(
    to_address: str,
    subject: str,
    body: str,
    from_address: str = "noreply@knotwork.io",
    smtp_host: str = "localhost",
    smtp_port: int = 587,
    smtp_user: str = "",
    smtp_password: str = "",
) -> None:
    """Send a plain-text email via SMTP (TLS on port 587, SSL on port 465)."""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_address
    msg["To"] = to_address
    msg.attach(MIMEText(body, "plain"))

    context = ssl.create_default_context()
    try:
        if smtp_port == 465:
            with smtplib.SMTP_SSL(smtp_host, smtp_port, context=context) as server:
                if smtp_user:
                    server.login(smtp_user, smtp_password)
                server.sendmail(from_address, [to_address], msg.as_string())
        else:
            with smtplib.SMTP(smtp_host, smtp_port) as server:
                server.ehlo()
                server.starttls(context=context)
                if smtp_user:
                    server.login(smtp_user, smtp_password)
                server.sendmail(from_address, [to_address], msg.as_string())
    except Exception as exc:
        logger.error("Email send to %s failed: %s", to_address, exc)
        raise

    logger.info("Email sent to %s", to_address)
