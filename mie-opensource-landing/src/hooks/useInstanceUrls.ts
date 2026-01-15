import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

export const useInstanceUrls = () => {
    const { siteConfig } = useDocusaurusContext();
    return {
        proxmoxUrl: siteConfig.customFields.proxmoxUrl as string,
        containerCreationUrl: siteConfig.customFields.containerCreationUrl as string,
    };
};
