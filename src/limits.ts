import type { A11yNode } from "./types";

type LimitResult = {
  node: A11yNode | null;
  truncated: boolean;
};

export function applyA11yLimits(root: A11yNode | null, maxDepth?: number, maxNodes?: number): LimitResult {
  if (!root) {
    return { node: null, truncated: false };
  }

  if (!maxDepth && !maxNodes) {
    return { node: root, truncated: false };
  }

  let remainingNodes = typeof maxNodes === "number" ? maxNodes : Number.POSITIVE_INFINITY;
  const depthLimit = typeof maxDepth === "number" ? maxDepth : Number.POSITIVE_INFINITY;
  let truncated = false;

  const walk = (node: A11yNode, depth: number): A11yNode | null => {
    if (remainingNodes <= 0) {
      truncated = true;
      return null;
    }

    if (depth > depthLimit) {
      truncated = true;
      return null;
    }

    remainingNodes -= 1;

    const children = Array.isArray(node.children) ? node.children : [];
    const limitedChildren: A11yNode[] = [];

    for (const child of children) {
      const limitedChild = walk(child, depth + 1);
      if (limitedChild) {
        limitedChildren.push(limitedChild);
      } else {
        if (remainingNodes <= 0 || depth + 1 > depthLimit) {
          truncated = true;
          break;
        }
      }
    }

    return {
      ...node,
      children: limitedChildren.length > 0 ? limitedChildren : undefined
    };
  };

  const limitedRoot = walk(root, 1);
  if (limitedRoot === null) {
    truncated = true;
  }

  return { node: limitedRoot, truncated };
}
