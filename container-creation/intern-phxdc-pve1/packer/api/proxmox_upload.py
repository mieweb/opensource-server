#!/usr/bin/env python3
import sys, argparse, warnings
from proxmox_utils import get_nodes, get_storages, upload_template, choose_default_storage

# Suppress insecure request warnings (e.g., if PROXMOX_API_URL has verify=False)
warnings.filterwarnings("ignore", category=requests.urllib3.exceptions.InsecureRequestWarning)

def main():
    parser = argparse.ArgumentParser(description="Upload Proxmox LXC template to all nodes.")
    parser.add_argument("--file", required=True, help="Path to the .tar.xz template file.")
    args = parser.parse_args()

    print(f"Starting template upload for: {args.file}")

    try:
        nodes = get_nodes()
        if not nodes:
            print("Error: No Proxmox nodes found.")
            sys.exit(1)

        print(f"Found nodes: {', '.join(nodes)}")

        for node in nodes:
            print(f"--- Processing Node: {node} ---")
            storages_list = get_storages(node)
            
            # Use the utility function to pick the best 'local' storage
            storage = choose_default_storage(storages_list)
            
            if not storage:
                print(f"Warning: No suitable storage found on node {node}. Skipping.")
                continue

            print(f"Uploading to {node}:{storage}...")
            try:
                result = upload_template(node, storage, args.file)
                print(f"Successfully uploaded to {node}:{storage}. Task: {result.get('data')}")
            except Exception as e:
                print(f"Error uploading to {node}:{storage}: {e}")

    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        sys.exit(1)

    print("Template upload process finished.")

if __name__ == "__main__":
    main()