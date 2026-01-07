import type { ReactNode } from "react";
import clsx from "clsx";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import styles from "./index.module.css";
import React from "react";
import BrowserOnly from '@docusaurus/BrowserOnly';
import Heading from "@theme/Heading";
import Link from "@docusaurus/Link";
import SyntaxHighlighter from 'react-syntax-highlighter';
import { github } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import { useInstanceUrls } from "@site/src/hooks/useInstanceUrls";

function HomepageHeader() {
    return (
        <header className={clsx("hero hero--primary", styles.heroBanner)}>
            <div className={styles.gridOverlay}></div>
            <div className={styles.heroContainer}>
                <div>
                    <h1 className={styles.heroTitle}>Opensource at MIE</h1>
                    <p className={styles.heroParagraph}>Empowering collaboration and innovation through open source, one commit at a time</p>
                    <BrowserOnly fallback={<div>Loading buttons...</div>}>
                        {() => {
                            const { HorizontalLayout } = require('@vaadin/react-components/HorizontalLayout.js');
                            const NavButton = require("@site/src/components/NavButton").default;
                            
                            return (
                                <HorizontalLayout theme="spacing" className={styles.buttons}>
                                    <NavButton 
                                        href="/docs/intro" 
                                        icon="vaadin:arrow-right" 
                                        text="Getting Started" 
                                    />
                                </HorizontalLayout>
                            );
                        }}
                    </BrowserOnly>
                </div>
            </div>
        </header>
    );
}

function DocumentationHighlites({ DiCode, GrCpu, GrCheckmark, GrCube, Button, Icon }: { DiCode: any, GrCpu: any, GrCheckmark: any, GrCube: any, Button: any, Icon: any }) {
    return (
        <div className={styles.documentationHighlightsParent}>
            <div className={styles.docGridOverlay}></div>
            <div className={styles.documentationHighlights}>
                <h2>Documentation Highlights</h2>
                <p className={styles.docIntro}>Explore our latest documentation to learn everything you need to know about getting set up with Proxmox, creating containers, and setting up automated deployments</p>
                <div className={styles.documentationGrid}>
                    <div className={styles.docSection}>
                        <div className={styles.docIcon}>
                            <GrCpu size={24} color="white" />
                        </div>
                        <h3>Opensource Infrastructure</h3>
                        <p className={styles.docDescription}>
                            Our robust infrastructure is built on Proxmox, providing a secure and scalable environment for all your containerized applications.
                        </p>
                        
                        <div className={styles.checklistItem}>
                            <GrCheckmark className={styles.checkIcon} />
                            <span>Proxmox virtualization platform</span>
                        </div>
                        <div className={styles.checklistItem}>
                            <GrCheckmark className={styles.checkIcon} />
                            <span>High-availability cluster</span>
                        </div>
                        <div className={styles.checklistItem}>
                            <GrCheckmark className={styles.checkIcon} />
                            <span>Security with Wazuh and LDAP</span>
                        </div>
                        
                        <Link to="/docs/infrastructure/overview" className={styles.docLink}>
                            Learn about our infrastructure →
                        </Link>
                    </div>
                
                    <div className={styles.docSection}>
                        <div className={styles.docIcon}>
                            <GrCube size={24} color="white" />
                        </div>
                        <h3>Manage and Create a Container</h3>
                        <p className={styles.docDescription}>
                            Create and deploy containers quickly with multiple interfaces to suit your workflow, from simple apps to complex systems.
                        </p>
                        
                        <div className={styles.checklistItem}>
                            <GrCheckmark className={styles.checkIcon} />
                            <span>Web GUI and CLI tools</span>
                        </div>
                        <div className={styles.checklistItem}>
                            <GrCheckmark className={styles.checkIcon} />
                            <span>Single and multi-component deployments</span>
                        </div>
                        <div className={styles.checklistItem}>
                            <GrCheckmark className={styles.checkIcon} />
                            <span>Predefined templates</span>
                        </div>
                        
                        <Link to="/docs/users/creating-containers/web-gui" className={styles.docLink}>
                            Get started with containers →
                        </Link>
                    </div>
                    
                    <div className={styles.docSection}>
                        <div className={styles.docIcon}>
                            <DiCode size={36} color="white" />
                        </div>
                        <h3>Automate your Workflow</h3>
                        <p className={styles.docDescription}>
                            Streamline your development process with our integrated CI/CD pipeline that creates environments for each branch automatically.
                        </p>
                        
                        <div className={styles.checklistItem}>
                            <GrCheckmark className={styles.checkIcon} />
                            <span>GitHub Actions integration</span>
                        </div>
                        <div className={styles.checklistItem}>
                            <GrCheckmark className={styles.checkIcon} />
                            <span>Isolated container environments</span>
                        </div>
                        <div className={styles.checklistItem}>
                            <GrCheckmark className={styles.checkIcon} />
                            <span>Public URLs and SSH access</span>
                        </div>
                        
                        <Link to="/docs/proxmox-launchpad/what-is-proxmox-launchpad" className={styles.docLink}>
                            Explore automation options →
                        </Link>
                    </div>
                </div>
            </div>
            <div className={styles.docButton}>
                <Link to="/docs/intro" style={{ textDecoration: 'none' }}>
                    <Button theme="primary" className={styles.docButton}>
                        View All Documentation
                        <Icon icon="vaadin:arrow-right" slot={'suffix'} />
                    </Button>
                </Link>
            </div>
        </div>
    );
}

function ManagingContainers({GrAdd, GrView, Snippet, Button, Icon, FaCode, FaTerminal, FaGlobe, FaShieldVirus, FaRocket, FaEye}: {GrAdd: any, GrView: any, Snippet: any, Button: any, Icon: any, FaCode: any, FaTerminal: any, FaGlobe: any, FaShieldVirus: any, FaRocket: any, FaEye: any}) {
    return (
        <div className={styles.ManagingContainersHeader}>
            <h2>Managing Containers</h2>
            <p>Create and access containers through multiple interfaces. Choose between command-line flexibility or web-based convenience.</p>
            <div className={styles.MCOptionsHeader}>
                <div className={styles.MCSection}>
                    <div className={styles.docIcon}>
                        <GrAdd size={24} color="white" />
                    </div>
                    <h3>Creating Containers</h3>
                    <p className={styles.MCSectionParagraph}>Deploy new containers instantly using your preferred method. The command line provides more flexibility while the web gui is more efficient.</p>
                    <div className={styles.mcInnerDiv}>
                        <h4>
                            <span className={styles.mcInnerDivIcon}>
                                <FaCode size={16} color="#2196F3" />
                            </span>
                            API with curl
                        </h4>
                        <p>Create containers programmatically using our REST API. Authenticate with your credentials and configure services through simple HTTP requests.</p>
                        <Link to="/docs/users/creating-containers/command-line" className={styles.docLink}>
                            View API documentation →
                        </Link>
                    </div>
                    <div className={styles.mcInnerDiv}>
                        <h4>
                            <span className={styles.mcInnerDivIcon}>
                                <FaGlobe size={16} color="#2196F3" />
                            </span>
                            Use the Web GUI
                        </h4>
                        <p>Deploy and manage containers easily through the Proxmox Web GUI. While this approach is less flexible for more complex container setups, its a lot faster.</p>
                        <Link to={useInstanceUrls().containerCreationUrl} style={{ textDecoration: 'none' }}>
                            <Button theme="primary" className={styles.Button}>
                                Open Web Interface
                                <Icon icon="vaadin:arrow-right" slot={'suffix'} />
                            </Button>
                        </Link>
                    </div>
                </div>
                <div className={styles.MCSection}>
                    <div className={styles.docIcon}>
                        <GrView size={24} color="white" />
                    </div>
                    <h3>Accessing Containers</h3>
                    <p className={styles.MCSectionParagraph}>Monitor and interact with your running containers through multiple access points.</p>
                    <div className={styles.mcInnerDiv}>
                        <h4>
                            <span className={styles.mcInnerDivIcon}>
                                <FaTerminal size={16} color="#2196F3" />
                            </span>
                            SSH Command
                        </h4>
                        <p>Connect securely to your running containers via SSH. Each container gets a unique URL that you can use to access your applications remotely.</p>
                        <SyntaxHighlighter className={styles.codeSnippet} language="bash" style={github} wrapLongLines>
                            {"ssh -p <port> <username>@opensource.mieweb.org"}
                        </SyntaxHighlighter>
                    </div>
                    <div className={styles.mcInnerDiv}>
                        <h4>
                            <span className={styles.mcInnerDivIcon}>
                                <FaGlobe size={16} color="#2196F3" />
                            </span>
                            Access via Proxmox Web GUI
                        </h4>
                        <p>Manage all of your containers right from the Proxmox Web GUI. This provides a user-friendly interface for monitoring container metrics and interacting with your applications.</p>
                        <Link to={useInstanceUrls().proxmoxUrl} style={{ textDecoration: 'none' }}>
                            <Button theme="primary" className={styles.Button}>
                                Login to Proxmox
                                <Icon icon="vaadin:arrow-right" slot={'suffix'} />
                            </Button>
                        </Link>
                    </div>
                </div>
            </div>
            <div className={styles.clusterHighlights}>
                <div className={styles.clusterItem}>
                    <h4>
                        <span className={styles.mcInnerDivIcon}>
                            <FaShieldVirus size={16} color="#7f8898ff" />
                        </span>
                        <span className={styles.clusterLabel}>Secure Access</span>
                    </h4>
                </div>
                <div className={styles.clusterDivider}></div>
                <div className={styles.clusterItem}>
                    <h4>
                        <span className={styles.mcInnerDivIcon}>
                            <FaRocket size={16} color="#7f8898ff" />
                        </span>
                        <span className={styles.clusterLabel}>High Performance</span>
                    </h4>
                </div>
                <div className={styles.clusterDivider}></div>
                <div className={styles.clusterItem}>
                    <h4>
                        <span className={styles.mcInnerDivIcon}>
                            <FaEye size={16} color="#7f8898ff" />
                        </span>
                        <span className={styles.clusterLabel}>24/7 Monitoring</span>
                    </h4>
                </div>
            </div>
        </div>
    );
}

function ProxmoxLaunchpad({Button, Icon, FaGithub, FaRocket, FaCheckCircle, FaComments}: {Button: any, Icon: any, FaGithub: any, FaRocket: any, FaCheckCircle: any, FaComments: any}) {
    const rocketImg = require('@site/static/img/rocketship.png').default;
    
    return (
        <div className={styles.proxmoxLaunchpadParent}>
            <div className={styles.gridOverlay}></div>
            <div className={styles.proxmoxLaunchpad}>
                <div className={styles.launchpadContent}>
                    {/* Left side - Animated Orbit */}
                    <div className={styles.orbitContainer}>
                        <div className={styles.orbitCircle}></div>
                        <img src={rocketImg} alt="Rocket" className={styles.rocket} />
                        <div className={styles.orbitItems}>
                            <div className={styles.orbitItem1}>
                                <FaGithub size={16} />
                                <span>git push</span>
                            </div>
                            <div className={styles.orbitItem2}>
                                <FaRocket size={16} />
                                <span>deploy</span>
                            </div>
                            <div className={styles.orbitItem3}>
                                <FaCheckCircle size={16} />
                                <span>success</span>
                            </div>
                        </div>
                    </div>

                    {/* Right side - Content */}
                    <div className={styles.launchpadInfo}>
                        <h2>Proxmox Launchpad</h2>
                        <p className={styles.launchpadDescription}>
                            Streamline your development workflow with our automated CI/CD GitHub Action. Deploy containers on every branch and update them 
                            on each push. Manage containers and runners effortlessly, with deployment status updates directly in your pull requests.
                        </p>
                        
                        <div className={styles.launchpadFeatures}>
                            <div className={styles.featureItem}>
                                <FaGithub className={styles.featureIcon} />
                                <div>
                                    <h4>GitHub Actions Integration</h4>
                                    <p>Seamlessly integrates with your existing GitHub workflow</p>
                                </div>
                            </div>
                            
                            <div className={styles.featureItem}>
                                <FaRocket className={styles.featureIcon} />
                                <div>
                                    <h4>Automatic Container Provisioning</h4>
                                    <p>Deploy, update, and delete containers automatically on every commit.</p>
                                </div>
                            </div>
                            
                            <div className={styles.featureItem}>
                                <FaComments className={styles.featureIcon} />
                                <div>
                                    <h4>PR Status Comments</h4>
                                    <p>Get deployment status updates directly in your pull requests</p>
                                </div>
                            </div>
                        </div>

                        <div className={styles.launchpadActions}>
                            <Link to="/docs/proxmox-launchpad/what-is-proxmox-launchpad" style={{ textDecoration: 'none' }}>
                                <Button theme="primary" className={styles.Button}>
                                    Get Started
                                    <Icon icon="vaadin:arrow-right" slot={'suffix'} />
                                </Button>
                            </Link>
                            <Link to="https://github.com/marketplace/actions/proxmox-launchpad" style={{ textDecoration: 'none' }}>
                                <Button theme="tertiary" className={styles.Button}>
                                    View on GitHub
                                    <Icon icon="vaadin:external-link" slot={'suffix'} />
                                </Button>
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}


export default function Home(): ReactNode {
    const { siteConfig } = useDocusaurusContext();
    return (
        <Layout
            title={`Home | ${siteConfig.title}`}
            description="Description will go into a meta tag in <head />"
        >
            <HomepageHeader />
            <main>
                <BrowserOnly>
                    {() => {
                        const { Button } = require("@vaadin/react-components/Button.js");
                        const { Icon } = require("@vaadin/react-components/Icon.js");
                        const { DiCode } = require("react-icons/di");
                        const { GrCpu } = require("react-icons/gr");
                        const { GrCheckmark } = require("react-icons/gr");
                        const { GrCube } = require("react-icons/gr");
                        const { GrAdd } = require("react-icons/gr");
                        const { GrView } = require("react-icons/gr");
                        const { FaCode } = require("react-icons/fa");
                        const { FaTerminal } = require("react-icons/fa");
                        const { FaGlobe} = require("react-icons/fa");
                        const { FaShieldVirus } = require("react-icons/fa");
                        const { FaRocket } = require("react-icons/fa");
                        const { FaEye } = require("react-icons/fa");
                        const { FaGithub } = require("react-icons/fa");
                        const { FaCheckCircle } = require("react-icons/fa");
                        const { FaComments } = require("react-icons/fa");
                        const { Snippet } = require("@heroui/snippet");
                        
                        require('@vaadin/icons');
                        
                        return (
                            <>
                                <ManagingContainers GrAdd={GrAdd} GrView={GrView} Snippet={Snippet} Button={Button} Icon={Icon} FaCode={FaCode} FaTerminal={FaTerminal} FaGlobe={FaGlobe} FaShieldVirus={FaShieldVirus} FaRocket={FaRocket} FaEye={FaEye} />
                                <ProxmoxLaunchpad Button={Button} Icon={Icon} FaGithub={FaGithub} FaRocket={FaRocket} FaCheckCircle={FaCheckCircle} FaComments={FaComments} />
                                <DocumentationHighlites DiCode={DiCode} GrCpu={GrCpu} GrCheckmark={GrCheckmark} GrCube={GrCube} Button={Button} Icon={Icon} />
                            </>
                        );
                    }}
                </BrowserOnly>
            </main>
        </Layout>
    );
}
