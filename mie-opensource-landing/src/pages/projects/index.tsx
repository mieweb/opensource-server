import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import BrowserOnly from '@docusaurus/BrowserOnly';
import React, { ReactNode } from "react";
import Heading from "@theme/Heading";
import styles from "./index.module.css";

export default function Home(): ReactNode {
    const { siteConfig } = useDocusaurusContext();

    return (
        <Layout
            title={`Projects | ${siteConfig.title}`}
            description="Description will go into a meta tag in <head />"
        >
            <main>
                <div className={styles.projectShowcase}>
                    <div className={styles.projectHeaderOverlay}></div>
                    <Heading as="h2" className="projectTitle">MIE Opensource Projects</Heading>
                    <p>Explore our open source projects and contributions.</p>
                    <BrowserOnly fallback={<div>Loading projects...</div>}>
                        {() => {
                            const ProjectGrid = require("@site/src/components/projectGrid").default;
                            return <ProjectGrid ProjectList={[""]} itemsPerPage={9} />;
                        }}
                    </BrowserOnly>
                </div>
            </main>
        </Layout>
    );
}