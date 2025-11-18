import styles from "./index.module.css";
import React, { useEffect, useRef, useState } from "react";
import BrowserOnly from '@docusaurus/BrowserOnly';
import ExecutionEnvironment from '@docusaurus/ExecutionEnvironment';
import { GrGithub } from "react-icons/gr";
import Link from "@docusaurus/Link";
import ReactPaginate from 'react-paginate';
import { TextField } from "@vaadin/react-components/TextField.js";
import { Tooltip } from "@vaadin/react-components/Tooltip.js";
import { Icon } from "@vaadin/react-components/Icon.js";

interface ProjectDetails {
    name: string;
    description: string;
    author: string;
    projectURL: string;
    gitHubURL: string;
}

interface ProjectGridProps {
    ProjectList?: string[];
    itemsPerPage?: number;
}

function useThemeAttribute() {
    const [theme, setTheme] = useState<string | null>(null);

    useEffect(() => {
        if (!ExecutionEnvironment.canUseDOM) {
            return;
        }

        const initialTheme = document.documentElement.getAttribute('data-theme');
        setTheme(initialTheme);

        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
                    const newTheme = document.documentElement.getAttribute('data-theme');
                    setTheme(newTheme);
                }
            });
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme']
        });

        return () => observer.disconnect();
    }, []);

    return theme;
}

export default function ProjectGrid({ ProjectList, itemsPerPage }: ProjectGridProps) {
    const [projectDetails, setProjectDetails] = useState<ProjectDetails[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchProjectDetails = async () => {
            let projectsToShowCase: string[];
            if ( !ProjectList || ProjectList.length === 0) {
                projectsToShowCase = ["vistamate", "mieweb-timeharbor-main", "landing-page", "lattln-questionnaire-builder-main", "mieapi-mcp-server", "rankroom"];
            } else {
                const response = await fetch('/api/all-projects');
                projectsToShowCase = await response.json();
            }
            
            try {
                const promises = projectsToShowCase.map(async (project) => {
                    const response = await fetch(`/api/projects/${project}`);

                    if (!response.ok) {
                        throw new Error(`Failed to fetch ${project}`);
                    }
                    const data = await response.json();
                    return {
                        name: project,
                        description: data.description || "No description available",
                        author: data.owner || "Unknown",
                        projectURL: `https://${project}.opensource.mieweb.org`,
                        gitHubURL: data.github_url
                    };
                });

                const results = await Promise.all(promises);
                setProjectDetails(results);
            } catch (err) {
                console.error('Error fetching project details:', err);
                setError(err instanceof Error ? err.message : 'Failed to fetch projects');
            } finally {
                setLoading(false);
            }
        };

        fetchProjectDetails();
    }, []);

    if (loading) {
        return (
            <div className={styles.projectShowcase}>
                <p>Loading projects...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.projectShowcase}>
                <p>Error loading projects: {error}</p>
            </div>
        );
    }

    return (
        <BrowserOnly fallback={<div>Loading projects...</div>}>
            {() => <ProjectGridClient projectDetails={projectDetails} itemsPerPage={itemsPerPage} />}
        </BrowserOnly>
    );
}

function ProjectGridClient({ projectDetails, itemsPerPage }: { projectDetails: ProjectDetails[], itemsPerPage?: number }) {
    const [projectsToShowCase, setProjectsToShowCase] = useState<ProjectDetails[]>(projectDetails);
    const [filteredProjects, setFilteredProjects] = useState<ProjectDetails[]>([]);
    const theme = useThemeAttribute();

    //Pagination
    const [itemOffset, setItemOffset] = useState(0);
    const [pageCount, setPageCount] = useState(0);
    const filterPagination = useRef(false);

    useEffect(() => {
        setProjectsToShowCase(projectDetails);
    }, [projectDetails]);

    useEffect(() => {
        if (itemsPerPage === undefined) return;
        console.log(filterPagination.current)
        if (filterPagination.current) {
            const endOffset = itemOffset + itemsPerPage;
            setProjectsToShowCase(filteredProjects.slice(itemOffset, endOffset));
            setPageCount(Math.ceil(filteredProjects.length / itemsPerPage));
        } else {
            const endOffset = itemOffset + itemsPerPage;
            setProjectsToShowCase(projectDetails.slice(itemOffset, endOffset));
            setPageCount(Math.ceil(projectDetails.length / itemsPerPage));
        }
    }, [projectDetails, itemOffset, itemsPerPage, filteredProjects]);

    const handlePageClick = (event: { selected: number }) => {
        const newOffset = (event.selected * itemsPerPage) % projectDetails.length;
        setItemOffset(newOffset);
    };

    const { Button } = require("@vaadin/react-components/Button.js");
    require('@vaadin/icons');
    
    const searchProjects = (event: Event) => {
        
        const target = event.target as HTMLInputElement;
        if (target.value.length < 1) {
            filterPagination.current = false;
            setProjectsToShowCase(projectDetails);
        }

        const value = target.value || "";
        let searchFilterResults = projectDetails.filter(project =>
            project.name.toLowerCase().includes(value.toLowerCase()) ||
            project.description.toLowerCase().includes(value.toLowerCase()) ||
            project.author.toLowerCase().includes(value.toLowerCase())
        );

        setFilteredProjects(searchFilterResults);
        filterPagination.current = true;
        setItemOffset(0);
    };

    return (
        <div className={styles.projectShowcase}>
            {itemsPerPage && 
                <TextField className={styles.TextField} placeholder="Search..." onInput={searchProjects} clearButtonVisible>
                    <Tooltip slot="tooltip" text="Search projects" />
                    <Icon slot="prefix" icon="vaadin:search" />
                </TextField>
            }
            <div className={styles.projectGrid}>
                {projectsToShowCase.map((project) => (
                    <div key={project.name} className={styles.projectCard}>
                        <div className={styles.projectHeader}>
                            <div className={styles.projectInfo}>
                                <h3 className={styles.projectName}>{project.name}</h3>
                                <p className={styles.projectAuthor}>{project.author}</p>
                            </div>
                            {project.gitHubURL && project.gitHubURL !== "" &&
                                <Link to={project.gitHubURL} style={{ textDecoration: 'none' }}>
                                    <GrGithub size={24} color={theme === 'dark' ? 'white' : 'black'} />
                                </Link>
                            }
                        </div>
                        <p className={styles.projectDescription}>{project.description}</p>
                        <Link to={project.projectURL} style={{ textDecoration: 'none' }}>
                            <Button className={styles.Button} theme="tertiary-inline" style={{
                                color: theme === 'dark' ? 'var(--ifm-color-primary-light)' : 'var(--ifm-color-primary)',
                            }}>
                                View Project
                            </Button>
                        </Link>
                    </div>
                ))}
            </div>
            <>
                {itemsPerPage && pageCount > 1 &&
                    <ReactPaginate
                        breakLabel="..."
                        nextLabel="next"
                        onPageChange={handlePageClick}
                        pageRangeDisplayed={3}
                        pageCount={pageCount}
                        previousLabel="previous"
                        renderOnZeroPageCount={null}
                        containerClassName={styles.pagination}
                        activeClassName={styles.activePage}
                        activeLinkClassName={styles.activeLinkPage}
                        pageClassName={styles.pageItem}
                        previousClassName={styles.pageItem}
                        pageLinkClassName={styles.pageLink}
                        nextClassName={styles.pageItem}
                    />
                }
            </>
        </div>
    );
}