packer {
  required_plugins {
    ansible = {
      version = ">=1.1.0"
      source  = "github.com/hashicorp/ansible"
    }
  }
}

variable "template_name" {
  default = "debian12-fungible"
}

variable "template_version" {
  type    = string
  default = "latest"
}

source "null" "local_build" {
  communicator = "none"
}

build {
  name    = "debian12-template"
  sources = ["source.null.local_build"]

  provisioner "shell" {
    inline = [
      "mkdir -p /tmp/rootfs",
      "wget -O /tmp/base.tar.zst http://download.proxmox.com/images/system/debian-12-standard_12.12-1_amd64.tar.zst",
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
      "mkdir -p /tmp/output",
      "cd /tmp/rootfs",
      # Use the variables to build the filename
      "tar -cJf /tmp/output/${var.template_name}_${var.template_version}.tar.xz .",
      "ls -lh /tmp/output"
    ]
  }
}
