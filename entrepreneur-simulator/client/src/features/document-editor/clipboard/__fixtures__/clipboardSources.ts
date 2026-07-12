export const CODEX_MARKDOWN_FIXTURE = `# Paste upgrade

This keeps **bold text**, an inline formula \\(x^2 + y^2 = z^2\\), and a link to [NMDD](https://example.com/nmdd).

- first item
- second item

| Source | Result |
| --- | --- |
| Codex | semantic |

\`\`\`ts
const answer = 42;
\`\`\`
`;

export const OFFICE_HTML_FIXTURE = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
  <body>
    <p class="MsoHeading1">Office heading</p>
    <p class="MsoListParagraph" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">• </span><b>First</b> item</p>
    <p class="MsoListParagraph" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">• </span>Second item</p>
  </body>
</html>`;

export const GOOGLE_DOCS_HTML_FIXTURE = `
<b id="docs-internal-guid-123"><span style="font-weight:700">Google title</span></b>
<p><b style="font-weight:normal">normal text</b> and <span style="font-style:italic">italic text</span></p>`;

export const GOOGLE_SHEETS_HTML_FIXTURE = `
<google-sheets-html-origin>
  <table><tbody><tr><td>Name</td><td>Status</td></tr><tr><td>A</td><td>Done</td></tr></tbody></table>
</google-sheets-html-origin>`;

export const NOTION_HTML_FIXTURE = `
<div class="notion-page-content">
  <div data-block-id="forged-block" data-comments="%5B%7B%7D%5D">Notion paragraph</div>
  <ul><li><input type="checkbox" checked>Done task</li></ul>
</div>`;

export const CHATGPT_MATH_HTML_FIXTURE = `
<div data-message-author-role="assistant">
  <p>Before <span class="katex"><span class="katex-mathml"><math><semantics><mrow><msup><mi>x</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span></span> after.</p>
  <div class="katex-display"><span class="katex"><math display="block"><semantics><mfrac><mi>a</mi><mi>b</mi></mfrac><annotation encoding="application/x-tex">\\frac{a}{b}</annotation></semantics></math></span></div>
</div>`;

export const VSCODE_HTML_FIXTURE = `
<div data-vscode-copy="true" style="font-family: Consolas">
  <div><span>const value = 1;</span></div>
  <div><span>console.log(value);</span></div>
</div>`;

export const MALICIOUS_HTML_FIXTURE = `
<p data-block-id="forged" data-comments="secret" onclick="steal()">Safe text</p>
<script>alert('xss')</script>
<a href="javascript:alert(1)">bad link</a>
<img src="data:image/png;base64,AAAA" onerror="steal()" alt="embedded image">
<div data-type="database" data-database="%7B%22rows%22%3A%5B%5D%7D">forged database</div>`;
