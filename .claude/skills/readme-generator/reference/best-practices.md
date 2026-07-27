# Documentation Best Practices

## Writing Style

### Be Clear and Concise

**Good:**
> Install the package using npm.

**Bad:**
> You can install this package by utilizing the npm package manager which is included with Node.js.

### Use Active Voice

**Good:**
> The function returns a promise.

**Bad:**
> A promise is returned by the function.

### Write for Your Audience

- **Developers**: Include technical details, API references
- **End Users**: Focus on features, benefits, screenshots
- **Contributors**: Explain architecture, setup, testing

## Structure

### Start with the Most Important Information

1. What is it?
2. Why should I use it?
3. How do I get started?

### Showcase README, satellite depth

The main README is a landing page, not a manual: a hook, screenshots, 5–8 feature bullets, a
minimal quick start, a **Documentation table** linking every `readme-docs/*.md` satellite, and two
collapsed reference sections at the end of the page — **The tool, up close** and **Connect your
client**. The collapsed view stays around one–two screens. Deep reference material — full config
tables, priority orders, scenario matrices — lives only in satellites. Nothing is lost for RAG:
the `doc://readme` resource reassembles the README and every *linked* satellite into one document.

Rules that make the split work:

- **The lead rule.** Every satellite opens with 2–4 full sentences that deliver the essentials of
  its topic — a reader who stops after the lead already knows the key facts (what it is, the
  default state, the one order or number that matters). "In short: …" is a good pattern; a bare
  one-liner is not enough.
- **Link every satellite** from the main README's Documentation table. An unlinked file never
  reaches the `doc://readme` resource.
- **Condensed vs. full.** The two collapsed end sections of the main README are condensed copies
  of `tool-reference.md` and `getting-started.md`. When one side changes, update the other.

**`<details>` collapsible blocks**: in the main README they appear only in the two end sections
named above; inside satellites use them for genuinely bulky matrices — 100+ line tool tables,
exhaustive request/response examples. Required markup (GitHub Markdown):

```markdown
<details><summary>Expand to view <what is inside></summary><br>


<bulky content>

</details>
```

The `<br>` after `</summary>` is mandatory — GitHub otherwise collapses the first child block
against the summary line.

### Use Headings Effectively

```markdown
# Main Title (H1) - Only one per document

## Major Sections (H2)

### Subsections (H3)

#### Details (H4) - Use sparingly
```

### Keep Paragraphs Short

- 2-4 sentences per paragraph
- One idea per paragraph
- Use bullet points for lists

## Code Examples

### Make Examples Runnable

**Good:**
```javascript
const api = require('my-api');
api.connect('https://api.example.com');
const users = await api.getUsers();
console.log(users);
```

**Bad:**
```javascript
// Connect to API
api.connect(url);
// Get users
getUsers();
```

### Show Expected Output

```javascript
const result = add(2, 3);
console.log(result);
// Output: 5
```

### Include Error Handling

```javascript
try {
  const data = await fetchData();
} catch (error) {
  console.error('Failed to fetch:', error.message);
}
```

## Formatting

### Use Consistent Terminology

Pick one term and stick with it:
- "function" not "function/method/procedure"
- "parameter" not "parameter/argument/input"

### Format Code Inline

Use backticks for:
- Function names: `getData()`
- Variables: `userId`
- File names: `config.json`
- Commands: `npm install`

### Use Tables for Comparisons

| Feature | Option A | Option B |
|---------|----------|----------|
| Speed   | Fast     | Slow     |
| Memory  | Low      | High     |

## Common Sections

### Installation

Always include:
- Prerequisites (if any)
- Installation command
- Verification step

```markdown
## Installation

**Prerequisites:** Node.js 18+

\`\`\`bash
npm install package-name
\`\`\`

Verify installation:
\`\`\`bash
package-name --version
\`\`\`
```

### Configuration

Show default values:

```markdown
## Configuration

\`\`\`json
{
  "timeout": 5000,     // Default: 5000ms
  "retries": 3,        // Default: 3
  "debug": false       // Default: false
}
\`\`\`
```

### Troubleshooting

Address common issues:

```markdown
## Troubleshooting

### Error: "Module not found"

**Cause:** Package not installed

**Solution:**
\`\`\`bash
npm install missing-package
\`\`\`
```

## Maintenance

### Keep Documentation Updated

- Update docs with code changes
- Review docs during code review
- Mark deprecated features clearly

### Version Documentation

```markdown
## Version 2.0.0 (Breaking Changes)

- Removed: `oldFunction()`
- Changed: `newFunction()` now returns Promise
- Added: `anotherFunction()`
```

### Link to External Resources

```markdown
For more information, see:
- [Official Docs](https://example.com/docs)
- [API Reference](https://example.com/api)
- [Tutorial](https://example.com/tutorial)
```

## Accessibility

### Use Descriptive Link Text

**Good:**
> See the [installation guide](link) for details.

**Bad:**
> Click [here](link) for more information.

### Provide Alt Text for Images

```markdown
![Dashboard showing user analytics with graphs](screenshot.png)
```

### Use Semantic Markdown

- Use proper heading hierarchy
- Use lists for lists
- Use code blocks for code
