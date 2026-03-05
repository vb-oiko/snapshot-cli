import { chromium } from "playwright";
import { applyA11yLimits } from "./limits";
import type { A11yNode, SnapshotOptions, SnapshotResult } from "./types";

type AxValue = {
  value?: string | number | boolean;
};

type AxNode = {
  nodeId: number;
  role?: AxValue;
  name?: AxValue;
  value?: AxValue;
  checked?: AxValue;
  childIds?: number[];
};

type AxTreeResponse = {
  nodes: AxNode[];
};

type GenericSession = {
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
};

async function getFullAxTree(session: GenericSession): Promise<AxTreeResponse> {
  const result = (await session.send(
    "Accessibility.getFullAXTree",
  )) as AxTreeResponse;
  return result;
}

async function getPartialAxTree(
  session: GenericSession,
  nodeId: number,
): Promise<AxTreeResponse> {
  const result = (await session.send("Accessibility.getPartialAXTree", {
    nodeId,
  })) as AxTreeResponse;
  return result;
}

async function resolveDomNodeId(
  session: GenericSession,
  selector: string,
): Promise<number> {
  const { root } = (await session.send("DOM.getDocument")) as {
    root: { nodeId: number };
  };
  const { nodeId } = (await session.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector,
  })) as { nodeId: number };

  return nodeId;
}

function extractValue(
  value: AxValue | undefined,
): string | number | boolean | undefined {
  if (!value || value.value === undefined || value.value === null) {
    return undefined;
  }

  return value.value;
}

function buildA11yTree(
  nodes: AxNode[],
  preferredNodeId?: number,
): A11yNode | null {
  if (nodes.length === 0) {
    return null;
  }

  const map = new Map<number, { node: A11yNode; childIds: number[] }>();

  for (const axNode of nodes) {
    const role = extractValue(axNode.role);
    const name = extractValue(axNode.name);
    const value = extractValue(axNode.value);
    const checked = extractValue(axNode.checked);

    map.set(axNode.nodeId, {
      node: {
        role: typeof role === "string" ? role : undefined,
        name: typeof name === "string" ? name : undefined,
        value:
          typeof value === "string" || typeof value === "number"
            ? value
            : undefined,
        checked: typeof checked === "boolean" ? checked : undefined,
      },
      childIds: axNode.childIds ?? [],
    });
  }

  let rootId: number | undefined = preferredNodeId;
  if (!rootId || !map.has(rootId)) {
    const candidate = nodes.find(
      (node) => extractValue(node.role) === "RootWebArea",
    );
    rootId = candidate?.nodeId ?? nodes[0]?.nodeId;
  }

  if (!rootId || !map.has(rootId)) {
    return null;
  }

  const visited = new Set<number>();
  const build = (id: number): A11yNode | null => {
    if (visited.has(id)) {
      return null;
    }

    const entry = map.get(id);
    if (!entry) {
      return null;
    }

    visited.add(id);

    const children: A11yNode[] = [];
    for (const childId of entry.childIds) {
      const child = build(childId);
      if (child) {
        children.push(child);
      }
    }

    return {
      ...entry.node,
      children: children.length > 0 ? children : undefined,
    };
  };

  return build(rootId);
}

export async function captureSnapshot(
  options: SnapshotOptions,
): Promise<SnapshotResult> {
  const timestamp = new Date().toISOString();
  let dom: string | undefined;
  let a11ySnapshot: A11yNode | null = null;
  let selectorFound = false;
  const warnings: string[] = [];

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const session = (await context.newCDPSession(
      page,
    )) as unknown as GenericSession;

    await page.goto(options.url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    let selectorNodeId: number | undefined;
    if (options.selector) {
      const handle = await page.$(options.selector);
      if (handle) {
        selectorFound = true;
        selectorNodeId = await resolveDomNodeId(session, options.selector);

        if (options.dom) {
          dom = await handle.evaluate((node) => node.outerHTML);
        }
      } else if (options.dom) {
        throw new Error(
          `selector not found for DOM slice: ${options.selector}`,
        );
      }
    }

    const axTree = selectorNodeId
      ? await getPartialAxTree(session, selectorNodeId)
      : await getFullAxTree(session);

    a11ySnapshot = buildA11yTree(axTree.nodes, axTree.nodes[0]?.nodeId);
  } finally {
    await browser.close();
  }

  const { node: limitedSnapshot, truncated } = applyA11yLimits(
    a11ySnapshot,
    options.maxDepth,
    options.maxNodes,
  );

  if (options.selector && !selectorFound) {
    warnings.push(
      `selector not found, falling back to full a11y snapshot: ${options.selector}`,
    );
  }

  return {
    metadata: {
      timestamp,
      url: options.url,
      selector: options.selector,
      maxDepth: options.maxDepth,
      maxNodes: options.maxNodes,
      truncated,
      warnings: warnings.length > 0 ? warnings : undefined,
    },
    a11y: limitedSnapshot,
    dom,
  };
}
