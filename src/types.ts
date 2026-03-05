export type OutputFormat = "json" | "md";

export interface SessionState {
  pid: number;
  port: number;
  startedAt: string;
}

export interface SmartOutputResult {
  inline: boolean;
  content?: string | unknown;
  dataUri?: string;
  file?: string;
  size: number;
  lines?: number;
  mimeType: string;
}

export interface NetworkRecord {
  type: "request" | "response";
  timestamp: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  // request-only
  postData?: string;
  // response-only
  status?: number;
  body?: string;
  bodySize?: number;
  bodyTruncated?: boolean;
  bodyFile?: string;
}

export interface ConsoleMessage {
  level: string;
  text: string;
  timestamp: string;
  url: string;
  lineNumber: number;
}

export interface ConsoleBuffer {
  messages: ConsoleMessage[];
  _truncated: boolean;
  _droppedCount: number;
}

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
