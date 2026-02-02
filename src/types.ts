export type OutputFormat = "json" | "md";

export interface SnapshotOptions {
  url: string;
  out: string;
  outDir?: string;
  format: OutputFormat;
  selector?: string;
  dom?: boolean;
  maxDepth?: number;
  maxNodes?: number;
}

export interface A11yNode {
  role?: string;
  name?: string;
  value?: string | number;
  checked?: boolean;
  children?: A11yNode[];
  [key: string]: unknown;
}

export interface SnapshotMetadata {
  timestamp: string;
  url: string;
  selector?: string;
  maxDepth?: number;
  maxNodes?: number;
  version?: string;
  truncated?: boolean;
  warnings?: string[];
}

export interface SnapshotResult {
  metadata: SnapshotMetadata;
  a11y: A11yNode | null;
  dom?: string;
}
