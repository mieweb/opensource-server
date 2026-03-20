import React from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

export const ProxmoxUrl = ({ children, path = '' }: { children?: React.ReactNode; path?: string }) => {
    const { siteConfig } = useDocusaurusContext();
    const url = (siteConfig.customFields.proxmoxUrl as string) + path;
    return children ? <a href={url}>{children}</a> : <>{url}</>;
};

export const ContainerCreationUrl = ({ children, path = '' }: { children?: React.ReactNode; path?: string }) => {
    const { siteConfig } = useDocusaurusContext();
    const url = (siteConfig.customFields.containerCreationUrl as string) + path;
    return children ? <a href={url}>{children}</a> : <>{url}</>;
};
