import { buildPublicAbsoluteUrl } from "../config/public-url";
import { renderMarkdownSafe } from "../security/markdown";
import type { ChangelogPostCategory, PublicPostSummary } from "./repository";

export const DEFAULT_RSS_LIMIT = 20;
export const MAX_RSS_LIMIT = 50;
const MAX_RSS_DESCRIPTION_LENGTH = 1_500;
const SUSPICIOUS_EXCERPT_PATTERN = /<|>|javascript:|\bon[a-z]+\s*=/i;

interface BuildRssDocumentInput {
  publicSiteUrl: string;
  posts: PublicPostSummary[];
  title?: string;
  description?: string;
  language?: string;
  generatedAt?: Date;
}

function escapeXmlText(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function toRssDate(value: string | Date): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return new Date(0).toUTCString();
  }
  return parsed.toUTCString();
}

function wrapCdata(input: string): string {
  return `<![CDATA[${input.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

function stripEncodedRawHtmlTags(input: string): string {
  return input.replace(/&lt;[^&]*&gt;/gi, " ");
}

function truncateAtWordBoundary(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }

  const slice = input.slice(0, maxLength);
  const lastWhitespace = slice.lastIndexOf(" ");
  const truncated = lastWhitespace > 0 ? slice.slice(0, lastWhitespace) : slice;
  return `${truncated.trim()}...`;
}

function sanitizeDescriptionHtml(excerpt: string): string {
  if (SUSPICIOUS_EXCERPT_PATTERN.test(excerpt)) {
    return "<p>Read the latest product updates from AllBooked.</p>";
  }

  const safeHtml = renderMarkdownSafe(excerpt.trim());
  const withoutEncodedTags = stripEncodedRawHtmlTags(safeHtml)
    .replace(/\bon[a-z]+\s*=/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!withoutEncodedTags) {
    return "<p>Read the latest product updates from AllBooked.</p>";
  }

  return truncateAtWordBoundary(withoutEncodedTags, MAX_RSS_DESCRIPTION_LENGTH);
}

function renderCategory(category: ChangelogPostCategory): string {
  return `<category>${escapeXmlText(category)}</category>`;
}

export function buildPublicChangelogRss(input: BuildRssDocumentInput): string {
  const channelTitle = input.title ?? "AllBooked Changelog";
  const channelDescription = input.description ?? "Public product updates from the AllBooked team.";
  const channelLanguage = input.language ?? "en-US";
  const channelLink = buildPublicAbsoluteUrl(input.publicSiteUrl, "/changelog");

  if (!channelLink) {
    throw new Error("publicSiteUrl is required to generate RSS links");
  }

  const mostRecentPublication = input.posts[0]?.publishedAt;
  const lastBuildDate = toRssDate(mostRecentPublication ?? input.generatedAt ?? new Date());

  const itemsXml = input.posts
    .map((post) => {
      const link = buildPublicAbsoluteUrl(input.publicSiteUrl, `/changelog/${post.slug}`);
      if (!link) {
        throw new Error("publicSiteUrl is required to generate item links");
      }

      return [
        "<item>",
        `  <title>${escapeXmlText(post.title)}</title>`,
        `  <link>${escapeXmlText(link)}</link>`,
        `  <guid isPermaLink="true">${escapeXmlText(link)}</guid>`,
        `  <pubDate>${escapeXmlText(toRssDate(post.publishedAt))}</pubDate>`,
        `  <description>${wrapCdata(sanitizeDescriptionHtml(post.excerpt))}</description>`,
        `  ${renderCategory(post.category)}`,
        "</item>"
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "<channel>",
    `  <title>${escapeXmlText(channelTitle)}</title>`,
    `  <link>${escapeXmlText(channelLink)}</link>`,
    `  <description>${escapeXmlText(channelDescription)}</description>`,
    `  <language>${escapeXmlText(channelLanguage)}</language>`,
    `  <lastBuildDate>${escapeXmlText(lastBuildDate)}</lastBuildDate>`,
    itemsXml,
    "</channel>",
    "</rss>"
  ].join("\n");
}
