packer {
  required_plugins {
    ansible = {
      version = ">=1.1.0"
      source  = "github.com/hashicorp/ansible"
    }
  }
}

variable "template_name" {
  default = "rocky9-lxc"
}

source "null" "local_build" {
  communicator = "none"
}

build {
  name    = "rocky9-template"
  sources = ["source.null.local_build"]

  provisioner "shell" {
    inline = [
      "set -eux",
      "mkdir -p /tmp/rootfs /tmp/output",
      # Download Proxmox Rocky 9 base rootfs
      "wget -O /tmp/base.tar.zst http://download.proxmox.com/images/system/rockylinux-9-standard_9.4-1_amd64.tar.zst",
      # Extract base
      "unzstd -d /tmp/base.tar.zst -o /tmp/base.tar",
      "tar -xf /tmp/base.tar -C /tmp/rootfs"
    ]
  }

  provisioner "ansible" {
    playbook_file = "./provisioners/ansible/site.yml"
    ansible_env_vars = [
      "ANSIBLE_CONFIG=./provisioners/ansible/ansible.cfg"
    ]
    extra_arguments = [
      "--connection=chroot",
      "--inventory", "/tmp/rootfs,",
    ]
  }

  provisioner "shell" {
    inline = [
      "set -eux",
      "cd /tmp/rootfs",
      "tar -cJf /tmp/output/${var.template_name}_$(date +%Y%m%d).tar.xz .",
      "ls -lh /tmp/output"
    ]
  }

  post-processor "shell-local" {
    inline = [
      "echo '✅ Rocky 9 LXC rootfs built successfully'",
      "ls -lh /tmp/output"
    ]
  }
}
