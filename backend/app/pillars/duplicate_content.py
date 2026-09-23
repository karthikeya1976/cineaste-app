"""Duplicate-content pillar — SHA-256 hash deduplication against S3.

Downloads the uploaded video and computes its SHA-256 hash. Checks the
database for any previously approved video with the same hash. If a match
is found, the video is flagged as duplicate — ensuring each creator's work
appears only once on the Misence platform.

Score: 0.0 (unique) → 1.0 (exact duplicate found).
Threshold: score >= 1.0 → flagged.
"""

import hashlib
import tempfile
import os

import boto3

from app import config
from app import db

_CHUNK = 8 * 1024 * 1024  # 8 MB chunks for large files


def _get_s3_client():
    creds = {}
    if config.AWS_ACCESS_KEY_ID and config.AWS_SECRET_ACCESS_KEY:
        creds = {
            "aws_access_key_id": config.AWS_ACCESS_KEY_ID,
            "aws_secret_access_key": config.AWS_SECRET_ACCESS_KEY,
        }
    return boto3.client("s3", region_name=config.AWS_S3_REGION, **creds)


def _sha256_of_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(_CHUNK), b""):
            h.update(chunk)
    return h.hexdigest()


async def check(job_id: str) -> dict:
    try:
        s3 = _get_s3_client()
        object_name = f"{job_id}.mp4"

        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            tmp_path = tmp.name
        s3.download_file(config.AWS_S3_BUCKET, object_name, tmp_path)
        file_hash = _sha256_of_file(tmp_path)
        os.unlink(tmp_path)

        # Store the hash on the job row so future uploads can compare
        db.update_job(job_id, {"file_hash": file_hash})

        # Check if any other completed job has the same hash
        is_duplicate = db.find_duplicate_hash(file_hash, exclude_job_id=job_id)

        score = 1.0 if is_duplicate else 0.0
        flags = []
        if is_duplicate:
            flags.append({
                "label": "duplicate_video",
                "detail": f"identical content already exists on the platform (sha256: {file_hash[:16]}…)",
            })

        return {"pillar": "duplicate_content", "score": round(score, 3), "flags": flags}

    except Exception as e:
        return {
            "pillar": "duplicate_content",
            "score": 0.0,
            "flags": [{"label": "check_error", "detail": str(e)}],
        }
