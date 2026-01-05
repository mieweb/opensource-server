---
sidebar_position: 3
---

# Protocol List

Below is a list of all protocols supported by the MIE Proxmox cluster.

:::note Note
You must specify any additional protocols that you want to use during the container creation process in the command line. If you need to, you can reference that documentation [here](/docs/users/creating-containers/basic-containers/command-line).
:::

:::important Important
Protocols in your container should listen on their default port. However, traffic for that protocol coming into our cluster will come in on a randomly-generated port number assigned to you, before being forwarded to your container on the default port. Therefore, traffic for that service using that protocol should be sent on that randomly-generated port assigned to you.
:::

| Protocol | Default Port | Type |
|----------|------|------|
| TCPM | 1 | tcp |
| RJE | 5 | tcp |
| ECHO | 7 | tcp |
| DISCARD | 9 | tcp |
| DAYTIME | 13 | tcp |
| QOTD | 17 | tcp |
| MSP | 18 | tcp |
| CHARGEN | 19 | tcp |
| FTP | 20 | tcp |
| FTP | 21 | tcp |
| SSH | 22 | tcp |
| TELNET | 23 | tcp |
| SMTP | 25 | tcp |
| TIME | 37 | tcp |
| HNS | 42 | tcp |
| WHOIS | 43 | tcp |
| TACACS | 49 | tcp |
| DNS | 53 | tcp |
| BOOTPS | 67 | udp |
| BOOTPC | 68 | udp |
| TFTP | 69 | udp |
| GOPHER | 70 | tcp |
| FINGER | 79 | tcp |
| HTTP | 80 | tcp |
| KERBEROS | 88 | tcp |
| HNS | 101 | tcp |
| ISO-TSAP | 102 | tcp |
| POP2 | 109 | tcp |
| POP3 | 110 | tcp |
| RPC | 111 | tcp |
| AUTH | 113 | tcp |
| SFTP | 115 | tcp |
| UUCP-PATH | 117 | tcp |
| NNTP | 119 | tcp |
| NTP | 123 | udp |
| EPMAP | 135 | tcp |
| NETBIOS-NS | 137 | tcp |
| NETBIOS-DGM | 138 | udp |
| NETBIOS-SSN | 139 | tcp |
| IMAP | 143 | tcp |
| SQL-SRV | 156 | tcp |
| SNMP | 161 | udp |
| SNMPTRAP | 162 | udp |
| XDMCP | 177 | tcp |
| BGP | 179 | tcp |
| IRC | 194 | tcp |
| LDAP | 389 | tcp |
| NIP | 396 | tcp |
| HTTPS | 443 | tcp |
| SNPP | 444 | tcp |
| SMB | 445 | tcp |
| KPASSWD | 464 | tcp |
| SMTPS | 465 | tcp |
| ISAKMP | 500 | udp |
| EXEC | 512 | tcp |
| LOGIN | 513 | tcp |
| SYSLOG | 514 | udp |
| LPD | 515 | tcp |
| TALK | 517 | udp |
| NTALK | 518 | udp |
| RIP | 520 | udp |
| RIPNG | 521 | udp |
| RPC | 530 | tcp |
| UUCP | 540 | tcp |
| KLOGIN | 543 | tcp |
| KSHELL | 544 | tcp |
| DHCPV6-C | 546 | tcp |
| DHCPV6-S | 547 | tcp |
| AFP | 548 | tcp |
| RTSP | 554 | tcp |
| NNTPS | 563 | tcp |
| SUBMISSION | 587 | tcp |
| IPP | 631 | tcp |
| LDAPS | 636 | tcp |
| LDP | 646 | tcp |
| LINUX-HA | 694 | tcp |
| ISCSI | 860 | tcp |
| RSYNC | 873 | tcp |
| VMWARE | 902 | tcp |
| FTPS-DATA | 989 | tcp |
| FTPS | 990 | tcp |
| TELNETS | 992 | tcp |
| IMAPS | 993 | tcp |
| POP3S | 995 | tcp |
| SOCKS | 1080 | tcp |
| OPENVPN | 1194 | udp |
| OMGR | 1311 | tcp |
| MS-SQL-S | 1433 | tcp |
| MS-SQL-M | 1434 | udp |
| WINS | 1512 | tcp |
| ORACLE-SQL | 1521 | tcp |
| RADIUS | 1645 | tcp |
| RADIUS-ACCT | 1646 | tcp |
| L2TP | 1701 | udp |
| PPTP | 1723 | tcp |
| CISCO-ISL | 1741 | tcp |
| RADIUS | 1812 | udp |
| RADIUS-ACCT | 1813 | udp |
| NFS | 2049 | tcp |
| CPANEL | 2082 | tcp |
| CPANEL-SSL | 2083 | tcp |
| WHM | 2086 | tcp |
| WHM-SSL | 2087 | tcp |
| DA | 2222 | tcp |
| ORACLE-DB | 2483 | tcp |
| ORACLE-DBS | 2484 | tcp |
| XBOX | 3074 | tcp |
| HTTP-PROXY | 3128 | tcp |
| MYSQL | 3306 | tcp |
| RDP | 3389 | tcp |
| NDPS-PA | 3396 | tcp |
| SVN | 3690 | tcp |
| MSQL | 4333 | udp |
| METASPLOIT | 4444 | tcp |
| EMULE | 4662 | tcp |
| EMULE | 4672 | udp |
| RADMIN | 4899 | tcp |
| UPNP | 5000 | tcp |
| YMSG | 5050 | tcp |
| SIP | 5060 | tcp |
| SIP-TLS | 5061 | tcp |
| AIM | 5190 | tcp |
| XMPP-CLIENT | 5222 | tcp |
| XMPP-CLIENTS | 5223 | tcp |
| XMPP-SERVER | 5269 | tcp |
| POSTGRES | 5432 | tcp |
| VNC | 5500 | tcp |
| VNC-HTTP | 5800 | tcp |
| VNC | 5900 | tcp |
| X11 | 6000 | tcp |
| BNET | 6112 | tcp |
| GNUTELLA | 6346 | tcp |
| SANE | 6566 | tcp |
| IRC | 6667 | tcp |
| IRCS | 6697 | tcp |
| BT | 6881 | tcp |
| HTTP-ALT | 8000 | tcp |
| HTTP-ALT | 8008 | tcp |
| HTTP-ALT | 8080 | tcp |
| HTTPS-ALT | 8443 | tcp |
| PDL-DS | 9100 | tcp |
| BACNET | 9101 | tcp |
| WEBMIN | 10000 | udp |
| MONGO | 27017 | tcp |
| TRACEROUTE | 33434 | udp |
