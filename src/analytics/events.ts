export const WHATS_NEW_EVENT_NAMES = [
  "whats_new.open_panel",
  "whats_new.open_full_page",
  "whats_new.open_post",
  "whats_new.mark_seen_success",
  "whats_new.mark_seen_failure",
  "whats_new.load_more"
] as const;

export type WhatsNewEventName = (typeof WHATS_NEW_EVENT_NAMES)[number];

export const WHATS_NEW_ANALYTICS_SURFACES = ["panel", "page"] as const;
export type WhatsNewAnalyticsSurface = (typeof WHATS_NEW_ANALYTICS_SURFACES)[number];

export const WHATS_NEW_ANALYTICS_RESULTS = ["success", "failure"] as const;
export type WhatsNewAnalyticsResult = (typeof WHATS_NEW_ANALYTICS_RESULTS)[number];

export const WHATS_NEW_ANALYTICS_PROPERTY_SCHEMA = {
  surface: {
    type: "string",
    enum_values: WHATS_NEW_ANALYTICS_SURFACES
  },
  tenant_id: {
    type: "string"
  },
  user_id: {
    type: "string"
  },
  post_id: {
    type: "string"
  },
  slug: {
    type: "string"
  },
  result: {
    type: "string",
    enum_values: WHATS_NEW_ANALYTICS_RESULTS
  },
  error_code: {
    type: "string"
  },
  pagination: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        required: true
      },
      cursor_present: {
        type: "boolean",
        required: true
      },
      page_index: {
        type: "number"
      }
    }
  }
} as const;

export type WhatsNewAnalyticsPropertyKey = keyof typeof WHATS_NEW_ANALYTICS_PROPERTY_SCHEMA;

export const WHATS_NEW_EVENT_PROPERTY_ALLOWLIST: Record<
  WhatsNewEventName,
  readonly WhatsNewAnalyticsPropertyKey[]
> = {
  "whats_new.open_panel": ["surface", "tenant_id", "user_id"],
  "whats_new.open_full_page": ["surface", "tenant_id", "user_id"],
  "whats_new.open_post": ["surface", "tenant_id", "user_id", "post_id", "slug"],
  "whats_new.mark_seen_success": ["surface", "tenant_id", "user_id", "result"],
  "whats_new.mark_seen_failure": ["surface", "tenant_id", "user_id", "result", "error_code"],
  "whats_new.load_more": ["surface", "tenant_id", "user_id", "pagination"]
};

export const WHATS_NEW_EVENT_REQUIRED_PROPERTIES: Record<
  WhatsNewEventName,
  readonly WhatsNewAnalyticsPropertyKey[]
> = {
  "whats_new.open_panel": ["surface"],
  "whats_new.open_full_page": ["surface"],
  "whats_new.open_post": ["surface"],
  "whats_new.mark_seen_success": ["surface", "result"],
  "whats_new.mark_seen_failure": ["surface", "result", "error_code"],
  "whats_new.load_more": ["surface", "pagination"]
};

export const WHATS_NEW_EVENTS_REQUIRING_POST_IDENTITY: readonly WhatsNewEventName[] = ["whats_new.open_post"];

export const WHATS_NEW_FORBIDDEN_PROPERTY_KEYS = [
  "title",
  "post_title",
  "body",
  "content",
  "body_markdown",
  "bodymarkdown",
  "markdown",
  "safe_html",
  "email",
  "user_email",
  "ip",
  "token",
  "authorization",
  "cookie",
  "set_cookie",
  "headers",
  "stack",
  "error_message",
  "message"
] as const;

export const WHATS_NEW_FORBIDDEN_PROPERTY_KEY_PATTERN =
  /(title|body|content|markdown|safe_html|email|ip|token|authorization|cookie|header|secret|password|stack|message)/i;

export const WHATS_NEW_ANALYTICS_TAXONOMY = {
  event_names: WHATS_NEW_EVENT_NAMES,
  property_schema: WHATS_NEW_ANALYTICS_PROPERTY_SCHEMA,
  event_property_allowlist: WHATS_NEW_EVENT_PROPERTY_ALLOWLIST,
  event_required_properties: WHATS_NEW_EVENT_REQUIRED_PROPERTIES,
  events_requiring_post_identity: WHATS_NEW_EVENTS_REQUIRING_POST_IDENTITY,
  forbidden_property_keys: WHATS_NEW_FORBIDDEN_PROPERTY_KEYS,
  forbidden_property_key_pattern: WHATS_NEW_FORBIDDEN_PROPERTY_KEY_PATTERN.source
} as const;

