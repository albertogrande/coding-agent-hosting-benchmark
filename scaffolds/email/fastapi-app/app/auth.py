import hashlib
import hmac
import os
import secrets

from fastapi import Header, HTTPException


def _secret() -> bytes:
    return os.environ.get("TOKEN_SECRET", "dev-only-secret").encode()


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=salt.encode(), n=2**14, r=8, p=1).hex()
    return f"{salt}:{digest}"


def verify_password(password: str, stored: str) -> bool:
    salt, _, digest = stored.partition(":")
    candidate = hashlib.scrypt(password.encode(), salt=salt.encode(), n=2**14, r=8, p=1).hex()
    return hmac.compare_digest(candidate, digest)


def issue_token(user_id: int) -> str:
    mac = hmac.new(_secret(), str(user_id).encode(), hashlib.sha256).hexdigest()
    return f"{user_id}.{mac}"


def current_user_id(authorization: str = Header(default="")) -> int:
    token = authorization.removeprefix("Bearer ").strip()
    user_id, _, _ = token.partition(".")
    if not user_id.isdigit() or not hmac.compare_digest(issue_token(int(user_id)), token):
        raise HTTPException(status_code=401, detail="sign in first")
    return int(user_id)
