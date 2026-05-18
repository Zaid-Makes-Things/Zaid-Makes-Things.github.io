const DATA_URL = "./assets/projects.json";
const NODE_SIZE = 48;
const INITIAL_ZOOM_SCALE = 0.35;

const svg = d3.select("#graph");
const filterToggle = document.getElementById("filter-toggle");
const filterMenu = document.getElementById("filter-menu");
const emptyState = document.getElementById("empty-state");
const nodeStatus = document.getElementById("node-status");
const nodeStatusId = document.getElementById("node-status-id");
const nodeStatusSeparator = document.getElementById("node-status-separator");
const nodeStatusTitle = document.getElementById("node-status-title");

const state = {
  allProjects: [],
  allFilterValues: {
    keywords: [],
    mediums: []
  },
  activeFilters: {
    keywords: new Set(),
    mediums: new Set()
  },
  filterMenuOpen: false,
  simulation: null,
  positionCache: new Map(),
  viewportGroup: null,
  zoomBehavior: null,
  zoomTransform: d3.zoomIdentity,
  hasAppliedInitialZoom: false,
  focusFilters: {
    keywords: null,
    mediums: null
  }
};

function normalizeProjectUrl(url) {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  const cleaned = url.replace(/^\.\//, "");
  return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
}

function getProjectSlug(url) {
  const fileName = url.split("/").pop() || "";
  return fileName.replace(/\.html?$/i, "");
}

function buildIconPath(url) {
  return `./assets/icons/${getProjectSlug(url)}.png`;
}

function enhanceProject(project) {
  return {
    ...project,
    normalizedUrl: normalizeProjectUrl(project.url),
    iconPath: buildIconPath(project.url)
  };
}

function collectFilterValues(projects) {
  const keywords = new Set();
  const mediums = new Set();

  projects.forEach((project) => {
    project.attributes.keywords.forEach((keyword) => keywords.add(keyword));
    project.attributes.mediums.forEach((medium) => mediums.add(medium));
  });

  state.allFilterValues.keywords = Array.from(keywords).sort((a, b) => a.localeCompare(b));
  state.allFilterValues.mediums = Array.from(mediums).sort((a, b) => a.localeCompare(b));
  state.activeFilters.keywords = new Set(state.allFilterValues.keywords);
  state.activeFilters.mediums = new Set(state.allFilterValues.mediums);
}

function getCategoryQueryKey(category) {
  return category === "keywords" ? "keywords" : "mediums";
}

function getCategoryFocusQueryKey(category) {
  return category === "keywords" ? "focusKeyword" : "focusMedium";
}

function getOrderedActiveValues(category) {
  return state.allFilterValues[category].filter((value) => state.activeFilters[category].has(value));
}

function getEffectiveSelectedValues(category) {
  if (state.focusFilters[category]) {
    return new Set([state.focusFilters[category]]);
  }

  return new Set(state.activeFilters[category]);
}

function isFilterValueEffectivelySelected(category, value) {
  return getEffectiveSelectedValues(category).has(value);
}

function resetFiltersToAll() {
  state.activeFilters.keywords = new Set(state.allFilterValues.keywords);
  state.activeFilters.mediums = new Set(state.allFilterValues.mediums);
}

function clearFocusFilters() {
  state.focusFilters.keywords = null;
  state.focusFilters.mediums = null;
}

function parseFilterListParam(params, paramName) {
  if (!params.has(paramName)) {
    return null;
  }

  const rawValue = params.get(paramName);

  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function applyUrlState() {
  const params = new URLSearchParams(window.location.search);
  resetFiltersToAll();
  clearFocusFilters();

  ["keywords", "mediums"].forEach((category) => {
    const paramName = getCategoryQueryKey(category);
    const parsedValues = parseFilterListParam(params, paramName);

    if (parsedValues === null) {
      return;
    }

    const allowedValues = new Set(state.allFilterValues[category]);
    const matchingValues = parsedValues.filter((value) => allowedValues.has(value));
    state.activeFilters[category] = new Set(matchingValues);
  });

  ["keywords", "mediums"].forEach((category) => {
    const paramName = getCategoryFocusQueryKey(category);
    const focusValue = params.get(paramName);

    if (focusValue && state.allFilterValues[category].includes(focusValue)) {
      state.focusFilters[category] = focusValue;
    }
  });
}

function updateUrlFromState() {
  const url = new URL(window.location.href);
  url.searchParams.delete("keywords");
  url.searchParams.delete("mediums");
  url.searchParams.delete("focusKeyword");
  url.searchParams.delete("focusMedium");

  ["keywords", "mediums"].forEach((category) => {
    const activeValues = getOrderedActiveValues(category);

    if (activeValues.length !== state.allFilterValues[category].length) {
      url.searchParams.set(getCategoryQueryKey(category), activeValues.join(","));
    }

    if (state.focusFilters[category]) {
      url.searchParams.set(getCategoryFocusQueryKey(category), state.focusFilters[category]);
    }
  });

  history.replaceState({}, "", url);
}

function syncFilterState({ clearFocus = false } = {}) {
  if (clearFocus) {
    clearFocusFilters();
  }

  updateGraph();
  renderFilters();
  updateUrlFromState();
}

function setNodeStatus(project) {
  if (!project) {
    nodeStatus.classList.add("is-empty");
    nodeStatusId.textContent = "";
    nodeStatusSeparator.textContent = "";
    nodeStatusTitle.textContent = "---";
    return;
  }

  nodeStatus.classList.remove("is-empty");
  nodeStatusId.textContent = project.id;
  nodeStatusSeparator.textContent = ":";
  nodeStatusTitle.textContent = project.title;
}

function getVisibleProjects() {
  return state.allProjects.filter((project) => {
    const keywordsVisible = project.attributes.keywords.every((keyword) =>
      state.activeFilters.keywords.has(keyword)
    );
    const mediumsVisible = project.attributes.mediums.every((medium) =>
      state.activeFilters.mediums.has(medium)
    );
    const focusKeywordVisible =
      !state.focusFilters.keywords || project.attributes.keywords.includes(state.focusFilters.keywords);
    const focusMediumVisible =
      !state.focusFilters.mediums || project.attributes.mediums.includes(state.focusFilters.mediums);

    return keywordsVisible && mediumsVisible && focusKeywordVisible && focusMediumVisible;
  });
}

function buildLinks(projects) {
  const links = [];

  for (let index = 0; index < projects.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < projects.length; nextIndex += 1) {
      const source = projects[index];
      const target = projects[nextIndex];
      const sourceKeywords = new Set(source.attributes.keywords);
      const sourceMediums = new Set(source.attributes.mediums);
      const sharedKeyword = target.attributes.keywords.some((keyword) => sourceKeywords.has(keyword));
      const sharedMedium = target.attributes.mediums.some((medium) => sourceMediums.has(medium));

      if (sharedMedium) {
        links.push({
          source: source.id,
          target: target.id,
          relationship: "medium"
        });
      } else if (sharedKeyword) {
        links.push({
          source: source.id,
          target: target.id,
          relationship: "keyword"
        });
      }
    }
  }

  return links;
}

function getViewport() {
  return {
    width: window.innerWidth,
    height: window.innerHeight
  };
}

function getGraphCenter(width, height) {
  if (width < 900) {
    return {
      x: width * 0.56,
      y: height * 0.68
    };
  }

  return {
    x: width * 0.73,
    y: height * 0.72
  };
}

function getInitialZoomTransform(width, height) {
  const translateX = (width - width * INITIAL_ZOOM_SCALE) / 2;
  const translateY = (height - height * INITIAL_ZOOM_SCALE) / 2;

  return d3.zoomIdentity.translate(translateX, translateY).scale(INITIAL_ZOOM_SCALE);
}

function getSimulationNodes(projects, width, height) {
  const center = getGraphCenter(width, height);

  return projects.map((project) => {
    const cachedPosition = state.positionCache.get(project.id);

    return {
      ...project,
      x: cachedPosition?.x ?? center.x + (Math.random() - 0.5) * 220,
      y: cachedPosition?.y ?? center.y + (Math.random() - 0.5) * 220
    };
  });
}

function setFilterMenuOpen(isOpen) {
  state.filterMenuOpen = isOpen;
  filterMenu.hidden = !isOpen;
  filterToggle.setAttribute("aria-expanded", String(isOpen));
  filterToggle.textContent = isOpen ? "– Filter" : "+ Filter";
}

function updateLoadedCount() {
  const visibleProjects = getVisibleProjects();
  const footer = document.createElement("div");
  footer.className = "filter-footer";
  footer.textContent = `Loaded: ${visibleProjects.length} node${visibleProjects.length === 1 ? "" : "s"}`;
  return footer;
}

function createActionButton(label, onClick, isAccent = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "filter-action";
  if (isAccent) {
    button.classList.add("is-accent");
  }
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function createTagButton(category, value) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tag-toggle";
  button.dataset.category = category;
  button.dataset.value = value;
  button.textContent = value;

  if (!isFilterValueEffectivelySelected(category, value)) {
    button.classList.add("is-inactive");
  }

  button.addEventListener("click", () => {
    toggleFilterValue(category, value);
  });

  return button;
}

function renderFilterGroup(category, label) {
  const section = document.createElement("section");
  section.className = "filter-group";

  const header = document.createElement("div");
  header.className = "filter-group-header";

  const heading = document.createElement("h2");
  heading.textContent = label;

  const actions = document.createElement("div");
  actions.className = "filter-actions";
  actions.append(
    createActionButton("deselect all", () => {
      state.activeFilters[category] = new Set();
      syncFilterState({ clearFocus: true });
    }),
    createActionButton("select all", () => {
      state.activeFilters[category] = new Set(state.allFilterValues[category]);
      syncFilterState({ clearFocus: true });
    }, true)
  );

  const tagList = document.createElement("div");
  tagList.className = "tag-list";

  state.allFilterValues[category].forEach((value, index) => {
    tagList.appendChild(createTagButton(category, value));

    if (index < state.allFilterValues[category].length - 1) {
      const separator = document.createElement("span");
      separator.className = "tag-separator";
      separator.textContent = ",";
      tagList.appendChild(separator);
    }
  });

  header.append(heading, actions);
  section.append(header, tagList);
  return section;
}

function renderFilters() {
  filterMenu.innerHTML = "";

  const sections = document.createElement("div");
  sections.className = "filter-sections";
  sections.append(
    renderFilterGroup("mediums", "Medium"),
    renderFilterGroup("keywords", "Keyword")
  );

  filterMenu.append(sections, updateLoadedCount());
}

function toggleFilterValue(category, value) {
  const nextValues = getEffectiveSelectedValues(category);

  if (nextValues.has(value)) {
    nextValues.delete(value);
  } else {
    nextValues.add(value);
  }

  state.activeFilters[category] = nextValues;
  syncFilterState({ clearFocus: true });
}

function initializeZoom() {
  state.zoomBehavior = d3
    .zoom()
    .scaleExtent([0.2, 4])
    .on("start", (event) => {
      if (event.sourceEvent?.type === "mousedown") {
        svg.classed("is-panning", true);
      }
    })
    .on("zoom", (event) => {
      state.zoomTransform = event.transform;

      if (state.viewportGroup) {
        state.viewportGroup.attr("transform", state.zoomTransform);
      }
    })
    .on("end", () => {
      svg.classed("is-panning", false);
    });

  svg.call(state.zoomBehavior).on("dblclick.zoom", null);
}

function applyInitialZoom() {
  if (state.hasAppliedInitialZoom) {
    return;
  }

  const { width, height } = getViewport();
  const initialTransform = getInitialZoomTransform(width, height);

  state.hasAppliedInitialZoom = true;
  svg.call(state.zoomBehavior.transform, initialTransform);
}

function drag(simulation) {
  function dragStarted(event, datum) {
    event.sourceEvent.stopPropagation();

    if (!event.active) {
      simulation.alphaTarget(0.22).restart();
    }

    datum.fx = datum.x;
    datum.fy = datum.y;
    setNodeStatus(datum);
  }

  function dragged(event, datum) {
    datum.fx = event.x;
    datum.fy = event.y;
  }

  function dragEnded(event, datum) {
    if (!event.active) {
      simulation.alphaTarget(0);
    }

    datum.fx = null;
    datum.fy = null;
  }

  return d3.drag().on("start", dragStarted).on("drag", dragged).on("end", dragEnded);
}

function isLinkConnectedToNode(link, nodeId) {
  const sourceId = typeof link.source === "object" ? link.source.id : link.source;
  const targetId = typeof link.target === "object" ? link.target.id : link.target;

  return sourceId === nodeId || targetId === nodeId;
}

function updateGraph() {
  const { width, height } = getViewport();
  const center = getGraphCenter(width, height);
  const visibleProjects = getVisibleProjects();
  const links = buildLinks(visibleProjects);
  const nodes = getSimulationNodes(visibleProjects, width, height);

  emptyState.hidden = visibleProjects.length !== 0;
  setNodeStatus(null);

  svg.attr("viewBox", `0 0 ${width} ${height}`);
  svg.selectAll("*").remove();

  if (state.simulation) {
    state.simulation.stop();
  }

  const viewportGroup = svg.append("g").attr("class", "graph-viewport");
  state.viewportGroup = viewportGroup;
  state.viewportGroup.attr("transform", state.zoomTransform);

  const linkSelection = viewportGroup
    .append("g")
    .attr("aria-hidden", "true")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("class", (datum) => `link-line link-line--${datum.relationship}`);

  const nodeSelection = viewportGroup
    .append("g")
    .selectAll("g")
    .data(nodes, (datum) => datum.id)
    .join("g")
    .attr("class", "node-group");

  nodeSelection
    .append("image")
    .attr("class", "node-image")
    .attr("href", (datum) => datum.iconPath)
    .attr("x", -NODE_SIZE / 2)
    .attr("y", -NODE_SIZE / 2)
    .attr("width", NODE_SIZE)
    .attr("height", NODE_SIZE)
    .attr("preserveAspectRatio", "xMidYMid slice");

  nodeSelection
    .append("rect")
    .attr("class", "node-frame")
    .attr("x", -NODE_SIZE / 2)
    .attr("y", -NODE_SIZE / 2)
    .attr("width", NODE_SIZE)
    .attr("height", NODE_SIZE);

  nodeSelection
    .on("mouseenter", function onMouseEnter(_, datum) {
      setNodeStatus(datum);
      d3.select(this).classed("is-hovered", true);
      linkSelection.classed("is-highlighted", (linkDatum) => isLinkConnectedToNode(linkDatum, datum.id));
    })
    .on("mouseleave", function onMouseLeave() {
      setNodeStatus(null);
      d3.select(this).classed("is-hovered", false);
      linkSelection.classed("is-highlighted", false);
    })
    .on("click", (_, datum) => {
      window.location.assign(datum.normalizedUrl);
    });

  state.simulation = createSimulation(nodes, links, center, linkSelection, nodeSelection);
  nodeSelection.call(drag(state.simulation));
}

function createSimulation(nodes, links, center, linkSelection, nodeSelection) {
  const simulation = d3
    .forceSimulation(nodes)
    .force(
      "link",
      d3
        .forceLink(links)
        .id((datum) => datum.id)
        .distance(170)
        .strength(0.28)
    )
    .force("charge", d3.forceManyBody().strength(-540))
    .force("center", d3.forceCenter(center.x, center.y))
    .force("collision", d3.forceCollide().radius(NODE_SIZE * 0.8));

  simulation.on("tick", () => {
    nodes.forEach((node) => {
      state.positionCache.set(node.id, {
        x: node.x,
        y: node.y
      });
    });

    linkSelection
      .attr("x1", (datum) => datum.source.x)
      .attr("y1", (datum) => datum.source.y)
      .attr("x2", (datum) => datum.target.x)
      .attr("y2", (datum) => datum.target.y);

    nodeSelection.attr("transform", (datum) => `translate(${datum.x}, ${datum.y})`);
  });

  return simulation;
}

function handleResize() {
  updateGraph();
}

function handleFilterToggle() {
  setFilterMenuOpen(!state.filterMenuOpen);
}

function handlePopState() {
  applyUrlState();
  renderFilters();
  updateGraph();
}

async function init() {
  try {
    const response = await fetch(DATA_URL);

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const rawProjects = await response.json();
    state.allProjects = rawProjects.map(enhanceProject);

    collectFilterValues(state.allProjects);
    applyUrlState();
    initializeZoom();
    applyInitialZoom();
    renderFilters();
    updateGraph();
    setFilterMenuOpen(false);

    filterToggle.addEventListener("click", handleFilterToggle);
    window.addEventListener("resize", handleResize);
    window.addEventListener("popstate", handlePopState);
  } catch (error) {
    console.error(error);
    emptyState.hidden = false;
    emptyState.textContent = "The project data could not be loaded.";
  }
}

window.addEventListener("DOMContentLoaded", init);
