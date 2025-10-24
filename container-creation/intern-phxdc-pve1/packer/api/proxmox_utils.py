# api/proxmox_utils.py
import os
import requests

API_URL = os.environ.get("PROXMOX_API_URL")
TOKEN_ID = os.environ.get("PROXMOX_TOKEN_ID")
TOKEN_SECRET = os.environ.get("PROXMOX_TOKEN_SECRET")

HEADERS = {
    "Authorization": f"PVEAPIToken={TOKEN_ID}={TOKEN_SECRET}"
}

def get_nodes():
    """Return a list of node names from the Proxmox cluster."""
    r = requests.get(f"{API_URL}/nodes", headers=HEADERS, verify=False)
    r.raise_for_status()
    data = r.json().get("data", [])
    return [n["node"] for n in data]

def get_storages(node):
    """Return available storages for a node."""
    r = requests.get(f"{API_URL}/nodes/{node}/storage", headers=HEADERS, verify=False)
    r.raise_for_status()
    return [s["storage"] for s in r.json().get("data", [])]

def upload_template(node, storage, filepath):
    """Upload a template tarball to a specific node and storage."""
    with open(filepath, "rb") as f:
        files = {"content": f}
        data = {
            "content": "vztmpl",
            "filename": os.path.basename(filepath)
        }
        r = requests.post(
            f"{API_URL}/nodes/{node}/storage/{storage}/upload",
            headers=HEADERS,
            files=files,
            data=data,
            verify=False
        )
        r.raise_for_status()
        return r.json()

def choose_default_storage(storages):
    """Pick the first local-type storage, or fallback to 'local'."""
    for s in storages:
        if s == "local" or "local" in s.lower():
            return s
    return storages[0] if storages else None
