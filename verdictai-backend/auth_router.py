"""
auth_router.py — Google OAuth verification + Email service
"""
import os
import logging
import aiosmtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])


# ─── Schemas ────────────────────────────────────────────────────────────────

class GoogleTokenRequest(BaseModel):
    credential: str  # JWT from Google Identity Services

class EmailRequest(BaseModel):
    email: str
    name: str = "User"


# ─── Google OAuth verify ─────────────────────────────────────────────────────

@router.post("/google")
async def verify_google_token(body: GoogleTokenRequest):
    """Verify a Google ID token and return user info."""
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    
    # NEW: Handle Demo Mode
    if body.credential == "demo_credential":
        log.info("Demo Login used.")
        return {
            "success": True,
            "user": {
                "email":   "tester@catalyst.ai",
                "name":    "Catalyst Tester",
                "picture": None,
                "sub":     "demo-123",
            }
        }

    if not client_id:
        raise HTTPException(status_code=500, detail="Google OAuth not configured (missing GOOGLE_CLIENT_ID).")
    try:
        info = google_id_token.verify_oauth2_token(
            body.credential,
            google_requests.Request(),
            client_id,
            clock_skew_in_seconds=10
        )
        return {
            "success": True,
            "user": {
                "email":   info.get("email"),
                "name":    info.get("name"),
                "picture": info.get("picture"),
                "sub":     info.get("sub"),
            }
        }
    except Exception as e:
        log.warning("Invalid Google token: %s", e)
        raise HTTPException(status_code=401, detail=f"Invalid Google token: {str(e)}")


# ─── Welcome / notification email ────────────────────────────────────────────

@router.post("/send-welcome")
async def send_welcome_email(body: EmailRequest):
    """Send a branded welcome email to the user from harshakya56@gmail.com."""
    gmail_user = os.getenv("GMAIL_USER", "harshakya56@gmail.com")
    gmail_pass = os.getenv("GMAIL_APP_PASSWORD")
    if not gmail_pass:
        raise HTTPException(status_code=500, detail="Email not configured (missing GMAIL_APP_PASSWORD).")

    # Generate a magic link with encoded name for personalization
    import base64
    safe_name = base64.b64encode(body.name.encode()).decode()
    magic_token = body.email.replace("@", "-at-").replace(".", "-dot-")
    verify_link = f"http://localhost:5173/?verify={magic_token}&email={body.email}&n={safe_name}"

    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {{ font-family: 'Georgia', serif; background: #F4F1EC; margin: 0; padding: 40px 20px; }}
        .container {{ max-width: 560px; margin: 0 auto; background: #fff; border-radius: 16px;
                      border: 1px solid #E8E2D6; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,.06); }}
        .header {{ background: #1B2A4A; padding: 36px 40px; }}
        .logo {{ font-family: Georgia, serif; font-size: 28px; color: #C6A96B; letter-spacing: -0.5px; }}
        .tagline {{ font-size: 12px; color: #9BAABF; margin-top: 4px; }}
        .body {{ padding: 36px 40px; }}
        h2 {{ font-size: 22px; color: #1B2A4A; font-weight: 700; margin-bottom: 16px; }}
        p {{ font-size: 15px; color: #3D3830; line-height: 1.7; margin-bottom: 14px; }}
        .highlight {{ background: #F7F4EE; border-left: 3px solid #C6A96B; padding: 14px 18px; border-radius: 8px; margin: 20px 0; font-size: 14px; color: #4A3A0E; }}
        .cta {{ display: inline-block; margin-top: 10px; padding: 13px 26px; background: #1B2A4A; color: #ffffff !important;
                text-decoration: none; border-radius: 10px; font-size: 15px; font-weight: 600; }}
        .footer {{ padding: 20px 40px; border-top: 1px solid #E8E2D6; font-size: 11px; color: #B5AFA4; }}
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">Catalyst</div>
          <div class="tagline">Decision Contestation Engine</div>
        </div>
        <div class="body">
          <h2>Verify your Identity 👋</h2>
          <p>Hello {body.name},</p>
          <p>Please click the button below to verify your account and access your Catalyst dashboard.</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="{verify_link}" class="cta">Verify & Sign In →</a>
          </div>

          <div class="highlight">
            Note: This link allows you to access Catalyst securely without a password.
          </div>
        </div>
        <div class="footer">
          This email was sent from Catalyst via harshakya56@gmail.com
        </div>
      </div>
    </body>
    </html>
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Verify your Catalyst Account"
    msg["From"] = f"Catalyst <{gmail_user}>"
    msg["To"] = body.email
    msg.attach(MIMEText(html, "html"))

    try:
        await aiosmtplib.send(
            msg,
            hostname="smtp.gmail.com",
            port=587,
            start_tls=True,
            username=gmail_user,
            password=gmail_pass,
        )
        return {"success": True, "message": f"Welcome email sent to {body.email}"}
    except Exception as e:
        log.error("Failed to send email: %s", e)
        raise HTTPException(status_code=500, detail=f"Email send failed: {str(e)}")
