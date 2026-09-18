import MarkdownIt from 'markdown-it';

// Only this locally configured renderer may produce HTML for assistant messages.
// Raw HTML, remote images and non-HTTP links never become DOM capabilities.
const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false });
const validateLink = markdown.validateLink.bind(markdown);
markdown.validateLink = (url: string) => /^https?:\/\//i.test(url) && validateLink(url);
markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(tokens[index].content);
markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('rel', 'noopener noreferrer');
  return renderer.renderToken(tokens, index, options);
};
export function renderAssistantMarkdown(text: string): string {
  return markdown.render(text);
}
