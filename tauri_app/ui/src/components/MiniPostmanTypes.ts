export interface HeaderItem {
  key: string;
  value: string;
  enabled: boolean;
}

export interface QueryParam {
  key: string;
  value: string;
  enabled: boolean;
}

export interface CookieInfo {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: string;
  http_only: boolean;
  secure: boolean;
}

export interface RedirectInfo {
  url: string;
  status: number;
}

export interface TimingBreakdown {
  dns_lookup_ms: number;
  tcp_connect_ms: number;
  tls_handshake_ms: number;
  first_byte_ms: number;
  total_ms: number;
}

export interface TestResult {
  name: string;
  passed: boolean;
}

export interface ApiResponse {
  status: number;
  statusText: string;
  elapsedMs: number;
  sizeBytes: number;
  headers: { [key: string]: string };
  body: string;
  testResults?: TestResult[];
  cookies?: CookieInfo[];
  redirect_chain?: RedirectInfo[];
  timing_breakdown?: TimingBreakdown;
}

export interface AuthConfig {
  type: string;
  bearerToken?: string;
  basicUsername?: string;
  basicPassword?: string;
  apiKeyName?: string;
  apiKeyValue?: string;
  apiKeyAddto?: string;
}

export interface TestConfig {
  status200: boolean;
  latencyUnder200: boolean;
  containsText: boolean;
  containsTextString: string;
  isValidJson: boolean;
}

export interface HistoryItem {
  id: string;
  name?: string;
  method: string;
  url: string;
  headers: { [key: string]: string };
  body: string;
  bodyType: string;
  timestamp: number;
  auth?: AuthConfig;
  tests?: TestConfig;
  response?: ApiResponse;
  scripts?: {
    preRequest: string;
    postResponse: string;
  };
}

export interface EnvironmentVariable {
  key: string;
  value: string;
  enabled: boolean;
}

export interface Environment {
  id: string;
  name: string;
  variables: EnvironmentVariable[];
}

export interface ScriptVariable {
  name: string;
  value: string;
  type: "string" | "number" | "boolean";
}

export type Method =
  | "GET"
  | "POST"
  | "PUT"
  | "DELETE"
  | "PATCH"
  | "OPTIONS"
  | "HEAD";
export type BodyType =
  | "none"
  | "json"
  | "text"
  | "urlencoded"
  | "xml"
  | "form-data"
  | "binary";
export type AuthType = "none" | "bearer" | "basic" | "apikey";
export type ReqTab =
  | "params"
  | "headers"
  | "body"
  | "auth"
  | "tests"
  | "scripts"
  | "tools"
  | "settings";
export type ResTab =
  | "body"
  | "headers"
  | "cookies"
  | "tests"
  | "timeline"
  | "schema";
export type SidebarTab = "history" | "saved" | "environments";
export type ToolsTab =
  | "dns"
  | "ping"
  | "ssl"
  | "jwt"
  | "hash"
  | "base64"
  | "timestamp"
  | "status"
  | "curl"
  | "diff"
  | "xml";
