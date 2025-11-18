import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

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
    onBrokenMarkdownLinks: "warn",

    i18n: {
        defaultLocale: "en",
        locales: ["en"],
    },

    presets: [
        [
            "classic",
            {
                docs: {
                    sidebarPath: "./sidebars.ts",
                    editUrl:
                        "https://github.com/maxklema/mie-opensource-landing/tree/master/",
                }
               
            } satisfies Preset.Options,
        ],
    ],

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
                    to: "https://create-a-container.opensource.mieweb.org",
                    label: "Create a Container",
                    position: "left",
                },
                {
                    to: "https://github.com/marketplace/actions/proxmox-launchpad",
                    label: "Proxmox Launchpad",
                    position: "left",
                },
                {
                    to: "/projects",
                    label: "Projects",
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
                            label: "Proxmox",
                            to: "/docs/category/introduction-to-proxmox"
                        },
                        {
                            label: "Creating Containers",
                            to: "/docs/creating-containers/basic-containers/web-gui",
                        },
                        {
                            label: "Proxmox Launchpad",
                            to: "/docs/proxmox-launchpad/what-is-proxmox-launchpad",
                        },
                        {
                            label: "Monitoring Containers",
                            to: "/docs/monitoring-container",
                        },
                        {
                            label: "VSCode Integration",
                            to: "/docs/vscode-setup",
                        },
                    ],
                },
                {
                    title: "Resources",
                    items: [
                        {
                            label: "Site Source",
                            href: "https://github.com/maxklema/mie-opensource-landing",
                        },
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
