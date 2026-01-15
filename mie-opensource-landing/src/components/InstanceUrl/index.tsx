import React from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

export const ProxmoxUrl = ({ children }: { children?: React.ReactNode }) => {
    const { siteConfig } = useDocusaurusContext();
    const url = siteConfig.customFields.proxmoxUrl as string;
    return children ? <a href={url}>{children}</a> : <>{url}</>;
};

export const ContainerCreationUrl = ({ children }: { children?: React.ReactNode }) => {
    const { siteConfig } = useDocusaurusContext();
    const url = siteConfig.customFields.containerCreationUrl as string;
    return children ? <a href={url}>{children}</a> : <>{url}</>;
};
