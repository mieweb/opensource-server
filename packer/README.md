Here is a README.md file that explains how your project works.

-----

# Proxmox LXC Template Automation 📦

This project automates the build, provisioning, and uploading of "fungible" Proxmox LXC container templates. It uses **Packer** to build the images, **Ansible** to provision them, and **Python** to upload them directly to your Proxmox cluster via the API.

This system is designed to run automatically (e.g., nightly via GitHub Actions) to ensure your base container templates are always up-to-date with the latest patches and common configurations.

## The Problem

Manually updating container templates is slow, error-prone, and leads to configuration drift. This automation solves that by:

  * **Ensuring templates are current** with upstream security patches.
  * **Pre-applying standard configuration** (like common packages, Wazuh, MOTD, etc.) before a container is ever created.
  * **Reducing manual workload** and enabling faster, more consistent automated deployments.

-----

## How It Works

The process is managed in distinct stages, usually kicked off by the GitHub Actions workflow.

### 1\. Trigger (GitHub Actions)

  * **File:** `.github/workflows/build-templates.yml`
  * **Action:** On a schedule (e.g., nightly) or a manual trigger, a new runner spins up.
  * **Steps:**
    1.  Installs the required tools: `packer`, `ansible`, `python3-requests`, and `zstd`.
    2.  Sets environment variables (like API secrets and a `TEMPLATE_VERSION`).

### 2\. Build (Packer)

  * **File:** `debian12.pkr.hcl` / `rocky9.pkr.hcl`
  * **Action:** The workflow runs the `packer build ...` command.
  * **Steps:**
    1.  **Download:** A `shell` provisioner downloads the official Proxmox base template (a `.tar.zst` file) from `download.proxmox.com`.
    2.  **Extract:** The file is decompressed and extracted into a temporary directory, `/tmp/rootfs`. This folder now contains the entire offline file system of the container.

### 3\. Provision (Ansible)

  * **File:** `provisioners/ansible/site.yml`
  * **Action:** Packer's `ansible` provisioner takes over.
  * **Steps:**
    1.  **The `chroot` Connection:** Ansible is told to use `--connection=chroot` and its "inventory" is just the `/tmp/rootfs` directory.
    2.  **Run Playbook:** Ansible runs all tasks *inside* that directory as if it were a running system. This is where it:
          * Installs packages (`vim`, `curl`, `git`, etc.).
          * Sets the "Message of the Day" (`/etc/motd`).
          * Copies over placeholder scripts for services like Wazuh. (These are designed *not* to run during the build, but rather on the container's first real boot).
          * Cleans up temporary files.

### 4\. Package (Packer)

  * **File:** `debian12.pkr.hcl`
  * **Action:** Packer runs its final `shell` provisioner.
  * **Steps:**
    1.  **Compress:** It `cd`s into the *modified* `/tmp/rootfs` directory.
    2.  **Create Tarball:** It creates a new, compressed `.tar.xz` file (e.g., `debian12-fungible_20251024.tar.xz`) containing the fully-provisioned file system.

### 5\. Upload (Python)

  * **File:** `api/proxmox_upload.py`
  * **Action:** The GitHub workflow's final step calls this Python script.
  * **Steps:**
    1.  **Authenticate:** The script reads the `PROXMOX_API...` environment variables and authenticates with the Proxmox API.
    2.  **Find Nodes:** It calls the `/nodes` API endpoint to get a list of all nodes in the cluster (e.g., `intern-phxdc-pve1`, `pve2`).
    3.  **Find Storage:** For *each* node, it calls the `/nodes/{node}/storage` endpoint to find available storage.
    4.  **Upload:** It intelligently picks the best `local`-type storage (falling back to `local`) and uploads the `.tar.xz` file to it.
    5.  **Repeat:** It repeats this process for *every node*, ensuring the template is available cluster-wide.

-----

## Prerequisites

To run this, you will need:

### Tools

  * [Packer](https://www.packer.io/downloads)
  * [Ansible](https://docs.ansible.com/ansible/latest/installation_guide/intro_installation.html)
  * [Python 3](https://www.python.org/) (with `requests` library)
  * `zstd` (for decompressing Proxmox templates: `apt install zstd`)

### Proxmox API Token

1.  In your Proxmox GUI, go to **Datacenter** -\> **Permissions** -\> **API Tokens**.
2.  Create a token (e.g., for `root@pam` or a dedicated automation user).
3.  **Permissions:** The token needs at minimum:
      * `Nodes.View` (to find nodes)
      * `Storage.View` (to find storage)
      * `Storage.Upload` (to upload the template)
      * `Datastore.AllocateTemplate` (implicitly used by upload)
4.  Copy the **Token ID** and **Token Secret** immediately.

-----

## Manual Usage (Demo)

You can run this entire process from any machine that has the tools installed (even the Proxmox node itself).

1.  **Clone the Repository:**

    ```bash
    git clone <your-repo-url>
    cd <your-repo-name>
    ```

2.  **Install Dependencies (on Debian):**

    ```bash
    apt-get update
    apt-get install -y packer ansible zstd python3-requests
    ```

3.  **Set Environment Variables:**

    ```bash
    # Use the API URL for your cluster
    export PROXMOX_API_URL="https://your-proxmox-ip:8006/api2/json"

    # Use the Token ID and Secret you just created
    export PROXMOX_TOKEN_ID="root@pam!your-token-id"
    export PROXMOX_TOKEN_SECRET="your-secret-uuid-here"

    # Define a version for the template file
    export TEMPLATE_VERSION=$(date +%Y%m%d)-manual
    ```

4.  **Run the Packer Build:**

    ```bash
    packer build \
      -var "template_version=${TEMPLATE_VERSION}" \
      debian12.pkr.hcl
    ```

    *This will download, extract, run Ansible, and create the final file in `/tmp/output/`.*

5.  **Run the Python Upload:**

    ```bash
    python3 api/proxmox_upload.py \
      --file /tmp/output/debian12-fungible_${TEMPLATE_VERSION}.tar.xz
    ```

    *This will upload the file to all nodes in your cluster.*

6.  **Verify:**
    Log in to your Proxmox GUI. Go to any node's `local` storage and click the **CT Templates** tab. You will see your new template, ready for cloning.