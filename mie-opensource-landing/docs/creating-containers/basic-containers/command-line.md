---
sidebar_position: 2
---

# Using The Command Line

:::note Note
This walkthrough assumes that you already have a registered proxmox account in the cluster. If not, see [Introduction](/docs/intro.md).
:::

This guide shows you how to set up a basic LXC container on the MIE Opensource Proxmox Cluster using the command line. We will walk you through several configuration steps, with exact prompts shown below.

## 1. Authenticate Your Proxmox Account

You'll be prompted for your credentials:

```
Enter Proxmox Username →  
Enter Proxmox Password →  
```

**Options:**
- Enter your valid Proxmox username and password
- If authentication fails, you'll see a "Authentication Failed. Try Again" message and be prompted again

## 2. Choose a Container Hostname

This will be your container's subdomain:

```
Enter Application Name (One-Word) →  
```

**Options:**
- Use a single word containing only letters, numbers, and hyphens (e.g., `myapp`, `test-api`)
- The hostname will be available at `your-hostname.opensource.mieweb.org`
- If the name is already taken or contains invalid characters, you'll be asked to choose another

## 3. Select a Linux Distribution

The script presents available distributions:

```
Available Linux Distributions:
1. Debian 12 (Bookworm)
2. Rocky 9 
Choose a Linux Distribution (debian/rocky) →  
```

**Options:**
- Type `debian` for Debian 12 (Bookworm)
- Type `rocky` for Rocky Linux 9
- Any invalid input defaults to Debian

## 4. Configure SSH Access

The script attempts to detect your SSH public key:

```
Attempting to Detect SSH Public Key...
```

If no key is detected:
```
Could not detect Public Key
Enter Public Key (Allows Easy Access to Container) [OPTIONAL - LEAVE BLANK TO SKIP] →  
```

**Options:**
- Enter your SSH public key (starts with `ssh-rsa`, `ssh-ed25519`, etc.)
- Leave blank to skip SSH key configuration
- Invalid keys will prompt for a valid key or blank entry

:::important Important
Entering a public key is highly recommended. It will allow you to access the create-container command line setup without entering a password. Additionally, it will allow you to SSH to your container without having to input your proxmox password, making the connection process faster and more secure.

To create a private/public key pair on your machine, reference [this guide](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent#generating-a-new-ssh-key).
:::

## 5. Set the HTTP Port

Specify which port your application will listen on:

```
Enter HTTP Port for your container to listen on (80-60000) →  
```

**Options:**
- Any number between 80 and 60,000
- Common choices: 80, 3000, 8080, 5000, 8000
- Invalid entries will prompt you to try again

## 6. Add Additional Protocols (Optional)

Configure additional protocols beyond SSH and HTTP:

```
Does your Container require any protocols other than SSH and HTTP? (y/n) →  
```

If you answer `y`:
```
Enter the protocol abbreviation (e.g, LDAP for Lightweight Directory Access Protocol). Type "e" to exit →  
```

**Options:**
- Answer `y` (yes) or `n` (no)
- If yes, enter protocol abbreviations one at a time (e.g., `LDAP`, `FTP`, `SMTP`)
- Type `e` when finished adding protocols
- The system validates each protocol against a master list
- Duplicate protocols are not allowed

:::note Note
To see a full list of protocols supported by our cluster, see the [Protocol Master List](/docs/intro.md).
:::


## 7. Automatic Project Deployment (Optional)

Choose whether to deploy your project when the container starts:

```
Do you want to deploy your project automatically? (y/n) →  
```

**Options:**
- `y` - Yes, deploy automatically (opens additional configuration options)
- `n` - No, I'll deploy manually later

:::note Note
If you choose to deploy automatically, see the documentation for doing so [here](/docs/intro.md).
:::

## 8. Container Creation Process

After providing all required information, the system will:
1. Transfer your configuration to the hypervisor
2. Begin the container creation process
3. Set up networking, DNS, and reverse proxy
4. Configure the container with your specified settings
5. Deploy your application if requested

Once the container creation process is complete, your container will be accessible via an ssh command in the form of:

```
ssh -p <your-container-port> <proxmox-username>@opensource.mieweb.org
```

## 9. Understanding the Output

Once your container is created, you will receieve an output that looks somthing like this:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔔  COPY THESE PORTS DOWN — For External Access
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌  Note: Your container listens on SSH Port 22 internally,
    but EXTERNAL traffic must use the SSH port listed below:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅  Hostname Registration: max-demo-container → 10.15.19.181
🔐  SSH Port               : 2376
🌐  HTTP Port              : 3000
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦  Container ID        : 116
🌐  Internal IP         : 10.15.19.181
🔗  Domain Name         : https://max-demo-container.opensource.mieweb.org
🛠️  SSH Access          : ssh -p 2376 demouser@max-demo-container.opensource.mieweb.org
🔑  Container Password  : Your proxmox account password
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NOTE: Additional background scripts are being ran in detached terminal sessions.
Wait up to two minutes for all processes to complete.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Still not working? Contact Max K. at maxklema@gmail.com
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

:::important Important
Your container password is the same as your Proxmox Account Password.
:::

The first block will list all of the ports that your container uses. By default, it will display an SSH Port and an HTTP Port. If you added any other special protocols, they will appear there as well.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅  Hostname Registration: max-demo-container → 10.15.19.181
🔐  SSH Port               : 2376
🌐  HTTP Port              : 3000
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

The second block contains network information about your container specifically, including its IP address, public domain name, and ssh command:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦  Container ID        : 116
🌐  Internal IP         : 10.15.19.181
🔗  Domain Name         : https://max-demo-container.opensource.mieweb.org
🛠️  SSH Access          : ssh -p 2376 demouser@max-demo-container.opensource.mieweb.org
🔑  Container Password  : Your proxmox account password
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

:::note Note
The IP that is given is an **internal IP** allocated by our local DHCP server. It is not public. Additionally, since we are setting up a basic container, nothing will be deployed yet, so navigating to the domain will return a 502 bad gateway error from our nginx server. This is expected.
:::

:::warning Warning
Save your SSH port number, as well as any port numbers, because you will not be able to see them again. This will be fixed at a later time.
:::

## 10. Viewing your Container on Proxmox

To see your container on the Proxmox GUI, navigate to [https://opensource.mieweb.org:8006](https://opensource.mieweb.org:8006). Once signed in, on the summary view, you should see the name of your container. If you double click on it, you will be able to access details, like the shell, metrics, and other network/filesystem information.

![Hostname](img/proxmox-lxc.jpg)

:::note Note
As of writing, you are able to reboot, start, and shutdown your container as you please. However, you must reach out to a cluster admin to delete your container.
:::

---

**Advanced Options**: For multi-component deployments, custom environment variables, or specific service configurations, refer to the [Advanced Container Configuration](/docs/category/creating-advanced-containers) documentation or contact the MIE team.
