import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false
});

export function renderMarkdownSafe(input: string): string {
  const rendered = markdown.render(input);

  return sanitizeHtml(rendered, {
    allowedTags: [
      "p",
      "strong",
      "em",
      "ul",
      "ol",
      "li",
      "a",
      "code",
      "pre",
      "blockquote",
      "h1",
      "h2",
      "h3",
      "h4"
    ],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      code: ["class"]
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          href: attribs.href ?? "#",
          title: attribs.title,
          target: "_blank",
          rel: "noopener noreferrer"
        }
      })
    }
  });
}
