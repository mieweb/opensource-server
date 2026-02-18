import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";
import dotenv from "dotenv";

dotenv.config();

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
    title: "Opensource at MIE",
    tagline:
        "A centralized place for all things open source at Medical Informatics Engineering (MIE)",
    favicon: "img/mie_favicon.ico",

    future: {
        v4: true,
    },

    url: "https://your-docusaurus-site.example.com",
    baseUrl: "/",

    organizationName: "maxklema",
    projectName: "mie-opensource-landing",

    onBrokenLinks: "throw",

    i18n: {
        defaultLocale: "en",
        locales: ["en"],
    },

    customFields: {
        proxmoxUrl: process.env.PROXMOX_URL || "https://localhost:8006",
        containerCreationUrl: process.env.CONTAINER_CREATION_URL || "https://localhost",
    },

    presets: [
        [
            "classic",
            {
                docs: {
                    sidebarPath: "./sidebars.ts",
                }
               
            } satisfies Preset.Options,
        ],
    ],

    themes: ["@docusaurus/theme-mermaid"],
    
    markdown: {
        mermaid: true,
        hooks: {
            onBrokenMarkdownLinks: "throw"
        }
    },

    themeConfig: {
        image: "img/docusaurus-social-card.jpg",
        navbar: {
            title: "Opensource at MIE",
            logo: {
                alt: "Opensource at MIE Logo",
                src: "img/mie_icon_logo.png",
            },
            items: [
                {
                    to: process.env.CONTAINER_CREATION_URL || "https://create-a-container.opensource.mieweb.org",
                    label: "Create a Container",
                    position: "left",
                },
                {
                    to: "https://github.com/marketplace/actions/proxmox-launchpad",
                    label: "Proxmox Launchpad",
                    position: "left",
                },
                {
                    type: "docSidebar",
                    sidebarId: "tutorialSidebar",
                    position: "left",
                    label: "Documentation",
                },
                {
                    href: "https://github.com/mieweb/opensource-server",
                    label: "GitHub",
                    position: "right",
                },
            ],
        },
        footer: {
            style: "light",
            links: [
                {
                    title: "Docs",
                    items: [
                        {
                            label: "Introduction",
                            to: "/docs/intro",
                        },
                        {
                            label: "Creating Containers",
                            to: "/docs/users/creating-containers/web-gui",
                        },
                        {
                            label: "Proxmox Launchpad",
                            to: "/docs/users/proxmox-launchpad/what-is-proxmox-launchpad",
                        },
                        {
                            label: "Monitoring Containers",
                            to: "/docs/users/monitoring-container",
                        },
                        {
                            label: "VSCode Integration",
                            to: "/docs/users/vscode-setup",
                        },
                        {
                            label: "Cluster Architecture",
                            to: "/docs/developers/system-architecture",
                        },
                    ],
                },
                {
                    title: "Resources",
                    items: [
                        {
                            label: "Opensource Cluster Source",
                            href: "https://github.com/mieweb/opensource-server",
                        },
                        {
                            label: "Proxmox Launchpad Source",
                            href: "https://github.com/mieweb/launchpad",
                        },
                        {
                            label: "Mieweb Github Organization",
                            href: "https://github.com/mieweb",
                        },

                    ],
                },
                 {
                    title: "Company",
                    items: [
                        {
                            label: "About Us",
                            href: "https://mieweb.org/about",
                        },
                        {
                            label: "Careers",
                            href: "https://mieweb.org/join-our-team",
                        },
                        {
                            label: "Our Team",
                            href: "https://mieweb.org/our-team",
                        },
                        {
                            label: "Privacy Policy",
                            href: "https://mieweb.org/privacy",
                        },
                        {
                            label: "Terms and Conditions of Use",
                            href: "https://mieweb.org/terms",
                        },
                    ],
                },
                {
                    title: "Community",
                    items: [
                        {
                            label: "LinkedIn",
                            href: "https://www.linkedin.com/company/medical-informatics-engineering-careers/",
                        },
                        {
                            label: "Facebook",
                            href: "https://facebook.com/mieweb",
                        }
                    ]
                }
            ],
            copyright: `Medical Informatics Engineering, LLC. Built with Docusaurus.`,
        },
        prism: {
            theme: prismThemes.github,
            darkTheme: prismThemes.dracula,
        },
    } satisfies Preset.ThemeConfig,
};

export default config;
