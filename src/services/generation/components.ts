import { generateWithClaude } from '../ai/clients.js';
import { createLogger } from '../../utils/logger.js';
import { generateId } from '../../utils/hash.js';
import * as esbuild from 'esbuild';
import type { GeneratedComponent, ContentOutline, GenerationContext, GeneratedContent } from './types.js';
import { validateComponentAlignment, regenerateWithAlignmentHints } from '../quality/alignment-validator.js';

const logger = createLogger('generation:components');

interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface ComponentSpec {
  type: string;
  purpose: string;
  placement: string;
  requirements: string[];
}

export interface ComponentGenerationResult {
  success: boolean;
  component?: GeneratedComponent;
  spec: ComponentSpec;
  error?: string;
  attempts: number;
}

export interface ComponentGenerationOutput {
  components: GeneratedComponent[];
  status: ComponentGenerationResult[];
}

const MAX_COMPONENT_RETRIES = 3;

export async function generateComponents(
  context: GenerationContext,
  outline: ContentOutline,
  content: GeneratedContent
): Promise<ComponentGenerationOutput> {
  logger.debug('Generating interactive components', {
    componentSpecs: outline.interactiveComponents.length,
  });

  const components: GeneratedComponent[] = [];
  const status: ComponentGenerationResult[] = [];

  for (const spec of outline.interactiveComponents) {
    const result = await generateComponentWithRetry(context, spec, content);
    status.push(result);
    if (result.success && result.component) {
      components.push(result.component);
    }
  }

  // Validate alignment and auto-fix components with errors
  if (components.length > 0) {
    const alignmentResult = await validateComponentAlignment(components, outline);

    for (const issue of alignmentResult.issues.filter(i => i.severity === 'error')) {
      const componentIndex = components.findIndex(c => c.id === issue.componentId);
      if (componentIndex >= 0) {
        logger.info('Regenerating component with alignment fix', {
          id: issue.componentId,
          issue: issue.description,
        });
        const fixedComponent = await regenerateWithAlignmentHints(
          components[componentIndex],
          issue.suggestion,
          { title: content.title, description: content.description }
        );
        components[componentIndex] = fixedComponent;

        // Update the status to reflect the fixed component
        const statusIndex = status.findIndex(s => s.component?.id === issue.componentId);
        if (statusIndex >= 0) {
          status[statusIndex].component = fixedComponent;
        }
      }
    }

    if (alignmentResult.suggestions.length > 0) {
      logger.debug('Alignment suggestions', { suggestions: alignmentResult.suggestions });
    }
  }

  logger.debug('Components generated', {
    count: components.length,
    succeeded: status.filter(s => s.success).length,
    failed: status.filter(s => !s.success).length,
  });

  return { components, status };
}

export async function generateComponentWithRetry(
  context: GenerationContext,
  spec: ContentOutline['interactiveComponents'][0],
  content: GeneratedContent
): Promise<ComponentGenerationResult> {
  let lastError: string | null = null;
  const componentSpec: ComponentSpec = {
    type: spec.type,
    purpose: spec.purpose,
    placement: spec.placement,
    requirements: spec.requirements,
  };

  for (let attempt = 1; attempt <= MAX_COMPONENT_RETRIES; attempt++) {
    try {
      const component = await generateComponent(context, spec, content, lastError);
      if (!component) {
        lastError = 'Component generation returned null';
        logger.warn("Component generation returned null on attempt " + attempt, { type: spec.type });
        continue;
      }

      const validation = await validateComponent(component);
      if (validation.valid) {
        logger.info("Component generated successfully on attempt " + attempt, { type: spec.type });
        return {
          success: true,
          component,
          spec: componentSpec,
          attempts: attempt,
        };
      }

      lastError = validation.error || 'Unknown validation error';
      logger.warn("Component validation failed on attempt " + attempt, {
        type: spec.type,
        error: lastError,
        attempt,
        maxRetries: MAX_COMPONENT_RETRIES
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown error';
      logger.error("Component generation threw error on attempt " + attempt, {
        type: spec.type,
        error: lastError,
      });
    }
  }

  logger.error("Component generation failed after " + MAX_COMPONENT_RETRIES + " attempts", {
    type: spec.type,
    lastError
  });

  return {
    success: false,
    spec: componentSpec,
    error: lastError || 'Max retries exceeded',
    attempts: MAX_COMPONENT_RETRIES,
  };
}

async function generateComponent(
  context: GenerationContext,
  spec: ContentOutline['interactiveComponents'][0],
  content: GeneratedContent,
  previousError?: string | null
): Promise<GeneratedComponent | null> {
  const prompt = buildComponentPrompt(spec, content, context, previousError);

  const response = await generateWithClaude(prompt, {
    maxTokens: 8192,
    temperature: 0.3,
    systemPrompt: `You are an expert React developer creating interactive educational components.
Write clean, well-structured TypeScript React components that work standalone.
The components will be rendered in an article about: ${content.title}

Requirements:
- Use TypeScript with proper types
- Use React hooks where needed
- Include Tailwind CSS classes for styling
- Make components self-contained (no external dependencies except React)
- Export the component as default

CRITICAL - STRING SYNTAX RULES (violations will break the build):
- NEVER use template literals (backticks) anywhere in your code
- For className with conditions, use string concatenation: "base " + (condition ? "a" : "b")
- For multi-line strings, use regular quotes with + concatenation
- For dynamic strings, use: "Hello " + name + "!"
- This applies to ALL strings, not just className

CRITICAL - COLOR CONTRAST RULES (violations cause invisible text):
- The page has a light/white background. NEVER use text-white or light text colors without a dark bg- class ON THE SAME ELEMENT.
- For table headers (th): use dark text (text-gray-700, text-gray-900) with a light background (bg-gray-50, bg-gray-100, bg-sky-50). NEVER use text-white on table headers.
- For table cells (td): use text-gray-700 or text-gray-900. NEVER use text-white.
- Always verify that every text element has sufficient contrast against its background.
- WRONG: className="text-white font-semibold" (white text on light page = invisible!)
- CORRECT: className="bg-sky-700 text-white font-semibold" (white text on dark bg = visible)
- SAFEST for tables: className="bg-gray-100 text-gray-900 font-semibold"`,
  });

  // Check for truncation
  if (response.stopReason === 'max_tokens') {
    logger.warn('Component generation truncated by max_tokens', {
      type: spec.type,
      outputLength: response.content.length,
    });
  }

  // Extract the code from the response
  const code = extractCode(response.content);
  if (!code) {
    logger.warn('No valid code extracted from response');
    return null;
  }

  const componentName = generateComponentName(spec.type);

  return {
    id: generateId(),
    type: spec.type,
    name: componentName,
    code,
    props: {},
    exports: [componentName],
  };
}

function buildComponentPrompt(
  spec: ContentOutline['interactiveComponents'][0],
  content: GeneratedContent,
  _context: GenerationContext,
  previousError?: string | null
): string {
  const componentExamples = getComponentExample(spec.type);

  let prompt = `Create a React component for an educational article.

ARTICLE CONTEXT:
Title: ${content.title}
Description: ${content.description}

COMPONENT REQUIREMENTS:
Type: ${spec.type}
Purpose: ${spec.purpose}
Section: ${spec.placement}
Requirements:
${spec.requirements.map(r => `- ${r}`).join('\n')}

${componentExamples}

Write a complete TypeScript React component. Include:
1. Proper TypeScript types/interfaces
2. React useState/useEffect hooks as needed
3. Tailwind CSS styling
4. Accessibility attributes (aria-labels, etc.)
5. Clear, educational UI

CRITICAL - NO TEMPLATE LITERALS (backticks):
Template literals cause build failures. You MUST use string concatenation instead.

WRONG (will fail):
  className={\`px-4 \${active ? "bg-blue-500" : "bg-gray-500"}\`}
  const msg = \`Hello \${name}\`;

CORRECT (use this):
  className={"px-4 " + (active ? "bg-blue-500" : "bg-gray-500")}
  const msg = "Hello " + name;

This rule applies to ALL strings in your entire component, not just className.

COLOR CONTRAST - MANDATORY:
- The page background is light (white/gray). All text must be dark enough to read.
- For table headers: use dark text (text-gray-900) with a light tinted background (bg-gray-100 or bg-sky-50). NEVER use text-white on table headers.
- For table cells: use text-gray-700 or text-gray-900. NEVER use text-white or text-gray-100.
- Only use text-white when the SAME element has a dark background class (e.g., bg-sky-700, bg-gray-800).

Other rules:
- All imports must be at the top (React, useState, useEffect, etc.)
- Export the component as default

Output ONLY the component code wrapped in \`\`\`tsx code blocks.
The component should be named ${generateComponentName(spec.type)}.`;

  if (previousError) {
    // Make the error message more explicit about template literals
    let errorExplanation = previousError;
    if (previousError.includes('Unterminated string literal')) {
      errorExplanation = 'BUILD FAILED: You used a template literal (backtick character \`) which is FORBIDDEN.\n\n' +
        'Original error: ' + previousError + '\n\n' +
        'The backtick character causes build failures. You MUST use string concatenation instead.\n\n' +
        'FIND AND REPLACE all instances like:\n' +
        '  \`text ${var}\`  -->  "text " + var\n' +
        '  \`${a} ${b}\`    -->  a + " " + b\n' +
        '  className={\`base ${x}\`}  -->  className={"base " + x}';
    }

    prompt += '\n\n' +
      '⚠️ PREVIOUS ATTEMPT FAILED ⚠️\n' +
      errorExplanation + '\n\n' +
      'MANDATORY FIX CHECKLIST:\n' +
      '1. Search your ENTIRE code for the backtick character (\`) - there should be ZERO\n' +
      '2. Convert ALL template literals to string concatenation using + and double quotes\n' +
      '3. Check for missing imports\n' +
      '4. Verify TypeScript types\n' +
      '5. Ensure valid JSX structure';
  }

  return prompt;
}

function getComponentExample(type: string): string {
  const examples: Record<string, string> = {
    quiz: `
EXAMPLE STRUCTURE:
- Multiple choice questions
- Immediate feedback on answers
- Score tracking
- "Try again" functionality`,

    playground: `
EXAMPLE STRUCTURE:
- Code editor/textarea
- Run/Execute button
- Output display
- Reset to original code`,

    diagram: `
EXAMPLE STRUCTURE:
- SVG visualization with hardcoded paths/shapes
- Interactive hover states using onMouseEnter/onMouseLeave
- Text labels with fixed positions
- Responsive sizing using viewBox

CRITICAL - Example className pattern:
  WRONG: className={\`p-4 \${isActive ? "bg-blue-500" : "bg-gray-500"}\`}
  CORRECT: className={"p-4 " + (isActive ? "bg-blue-500" : "bg-gray-500")}

For SVG text, use regular strings:
  WRONG: <text>{\`Value: \${count}\`}</text>
  CORRECT: <text>{"Value: " + count}</text>`,

    calculator: `
EXAMPLE STRUCTURE:
- Input fields for parameters
- Calculate button
- Results display
- Clear explanation of formula`,

    'comparison-table': `
EXAMPLE STRUCTURE:
- Feature comparison grid with hardcoded data array
- Sortable columns using onClick handlers
- Highlighted recommendations with conditional styling
- Expandable rows using useState

CRITICAL - Table header styling:
  Table headers MUST use dark text on a light background. The page background is white/light gray.
  WRONG: <th className="text-white font-semibold">  (invisible white text on light bg!)
  WRONG: <th className="bg-sky-600 text-white">  (risky - if bg fails to load, text disappears)
  CORRECT: <th className="bg-gray-100 text-gray-900 font-semibold px-4 py-3 text-left">
  CORRECT: <th className="bg-sky-50 text-sky-900 font-semibold px-4 py-3 text-left">

CRITICAL - Example patterns:
  Data array (use regular objects, not template strings):
    const data = [
      { name: "Option A", feature1: true, feature2: false },
      { name: "Option B", feature1: true, feature2: true }
    ];

  Conditional className:
    WRONG: className={\`cell \${item.recommended ? "bg-green-100" : ""}\`}
    CORRECT: className={"cell " + (item.recommended ? "bg-green-100" : "")}

  Dynamic text:
    WRONG: {\`\${item.name}: \${item.value}\`}
    CORRECT: {item.name + ": " + item.value}`,
  };

  return examples[type] || '';
}

function generateComponentName(type: string): string {
  const names: Record<string, string> = {
    quiz: 'KnowledgeQuiz',
    playground: 'CodePlayground',
    diagram: 'InteractiveDiagram',
    calculator: 'Calculator',
    'comparison-table': 'ComparisonTable',
  };

  return names[type] || 'InteractiveComponent';
}

function extractCode(response: string): string | null {
  // Try to extract code from markdown code blocks
  // Handle \r\n line endings and optional space after language tag
  // Use both greedy (with closing fence) and fallback (without closing fence) patterns

  // First try with proper closing fence
  const tsxMatch = response.match(/```tsx\s*\r?\n([\s\S]*?)```/);
  if (tsxMatch) {
    logger.debug('Code extracted via tsx regex');
    return sanitizeTemplateLiterals(tsxMatch[1].trim());
  }

  const tsMatch = response.match(/```typescript\s*\r?\n([\s\S]*?)```/);
  if (tsMatch) {
    logger.debug('Code extracted via typescript regex');
    return sanitizeTemplateLiterals(tsMatch[1].trim());
  }

  const jsxMatch = response.match(/```jsx\s*\r?\n([\s\S]*?)```/);
  if (jsxMatch) {
    logger.debug('Code extracted via jsx regex');
    return sanitizeTemplateLiterals(jsxMatch[1].trim());
  }

  const genericMatch = response.match(/```\r?\n([\s\S]*?)```/);
  if (genericMatch) {
    const extracted = genericMatch[1].trim();
    const firstLine = extracted.split('\n')[0].trim().toLowerCase();
    if (firstLine === 'tsx' || firstLine === 'typescript' || firstLine === 'jsx' || firstLine === 'javascript') {
      logger.debug('Code extracted via generic regex, stripping language tag: ' + firstLine);
      return sanitizeTemplateLiterals(extracted.substring(extracted.indexOf('\n') + 1).trim());
    }
    logger.debug('Code extracted via generic regex');
    return sanitizeTemplateLiterals(extracted);
  }

  // Fallback: code block opened but never closed (LLM output truncated or omitted closing fence)
  const unclosedMatch = response.match(/```(?:tsx|typescript|jsx|javascript)?\s*\r?\n([\s\S]+)/);
  if (unclosedMatch) {
    let extracted = unclosedMatch[1].trim();
    // Strip any trailing ``` that might be partial
    if (extracted.endsWith('``')) extracted = extracted.slice(0, -2).trim();
    else if (extracted.endsWith('`')) extracted = extracted.slice(0, -1).trim();
    logger.info('Code extracted via unclosed code block fallback (LLM may have been truncated)', { codeLength: extracted.length });
    return sanitizeTemplateLiterals(extracted);
  }

  // If no code blocks, check if the whole response is code
  if (response.includes('export default') || response.includes('function ') || response.includes('const ')) {
    logger.debug('Code extracted as raw response (no code blocks found)');
    return sanitizeTemplateLiterals(response.trim());
  }

  return null;
}

/**
 * Convert template literals to string concatenation using a character-by-character parser.
 * This fixes LLM-generated code that uses backticks, which esbuild rejects as
 * "Unterminated string literal" when processed without module support.
 *
 * Handles: nested template literals, ${} expressions with nested braces,
 * dollar signs without braces, and strings/comments containing backticks.
 */
function sanitizeTemplateLiterals(code: string): string {
  if (!code.includes('`')) return code;

  const result: string[] = [];
  let i = 0;

  while (i < code.length) {
    // Skip single-quoted strings
    if (code[i] === "'") {
      const end = skipString(code, i, "'");
      result.push(code.substring(i, end));
      i = end;
      continue;
    }

    // Skip double-quoted strings
    if (code[i] === '"') {
      const end = skipString(code, i, '"');
      result.push(code.substring(i, end));
      i = end;
      continue;
    }

    // Skip single-line comments
    if (code[i] === '/' && code[i + 1] === '/') {
      const newline = code.indexOf('\n', i);
      const end = newline === -1 ? code.length : newline + 1;
      result.push(code.substring(i, end));
      i = end;
      continue;
    }

    // Skip block comments
    if (code[i] === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      const commentEnd = end === -1 ? code.length : end + 2;
      result.push(code.substring(i, commentEnd));
      i = commentEnd;
      continue;
    }

    // Template literal found — parse and convert it
    if (code[i] === '`') {
      const converted = parseTemplateLiteral(code, i + 1);
      result.push(converted.replacement);
      i = converted.endIndex;
      continue;
    }

    // Regular character
    result.push(code[i]);
    i++;
  }

  const sanitized = result.join('');
  if (code !== sanitized) {
    logger.info('Sanitized template literals', {
      hadBackticks: true,
      hasBackticks: sanitized.includes('`'),
    });
  }
  return sanitized;
}

/** Skip past a string literal (single or double quoted), handling escape sequences. */
function skipString(code: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < code.length) {
    if (code[i] === '\\') {
      i += 2; // skip escaped character
      continue;
    }
    if (code[i] === quote) {
      return i + 1;
    }
    i++;
  }
  return code.length; // unterminated string, consume to end
}

/**
 * Parse a template literal starting after the opening backtick.
 * Returns the string-concatenation replacement and the index after the closing backtick.
 * Recursively handles nested template literals inside ${} expressions.
 */
function parseTemplateLiteral(code: string, start: number): { replacement: string; endIndex: number } {
  const parts: string[] = [];
  let textBuf = '';
  let i = start;

  while (i < code.length) {
    // Closing backtick — end of this template literal
    if (code[i] === '`') {
      if (textBuf.length > 0) {
        parts.push('"' + textBuf.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"');
      }
      const replacement = parts.length === 0 ? '""' : parts.length === 1 ? parts[0] : parts.join(' + ');
      return { replacement, endIndex: i + 1 };
    }

    // Escape sequence inside template literal
    if (code[i] === '\\') {
      // Preserve common escapes as their literal characters
      if (i + 1 < code.length) {
        const next = code[i + 1];
        if (next === 'n') { textBuf += '\n'; }
        else if (next === 'r') { textBuf += '\r'; }
        else if (next === 't') { textBuf += '\t'; }
        else if (next === '\\') { textBuf += '\\'; }
        else if (next === '`') { textBuf += '`'; }
        else if (next === '$') { textBuf += '$'; }
        else { textBuf += code[i + 1]; }
        i += 2;
        continue;
      }
    }

    // Interpolation expression: ${...}
    if (code[i] === '$' && code[i + 1] === '{') {
      // Flush text buffer
      if (textBuf.length > 0) {
        parts.push('"' + textBuf.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"');
        textBuf = '';
      }

      // Parse the expression inside ${}, handling nested braces and template literals
      const expr = parseInterpolationExpr(code, i + 2);
      parts.push('(' + expr.content + ')');
      i = expr.endIndex;
      continue;
    }

    // Regular character
    textBuf += code[i];
    i++;
  }

  // Unterminated template literal — best-effort: flush what we have
  if (textBuf.length > 0) {
    parts.push('"' + textBuf.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"');
  }
  const replacement = parts.length === 0 ? '""' : parts.length === 1 ? parts[0] : parts.join(' + ');
  return { replacement, endIndex: code.length };
}

/**
 * Parse the expression inside a ${} interpolation, starting after the `{`.
 * Handles nested braces, nested template literals, and string literals.
 * Returns the raw expression content and the index after the closing `}`.
 */
function parseInterpolationExpr(code: string, start: number): { content: string; endIndex: number } {
  let depth = 1;
  let i = start;
  const exprParts: string[] = [];

  while (i < code.length && depth > 0) {
    // Nested template literal inside expression — recursively convert it
    if (code[i] === '`') {
      const nested = parseTemplateLiteral(code, i + 1);
      exprParts.push(nested.replacement);
      i = nested.endIndex;
      continue;
    }

    // Skip string literals inside expression
    if (code[i] === "'" || code[i] === '"') {
      const end = skipString(code, i, code[i]);
      exprParts.push(code.substring(i, end));
      i = end;
      continue;
    }

    if (code[i] === '{') depth++;
    if (code[i] === '}') {
      depth--;
      if (depth === 0) {
        return { content: exprParts.join(''), endIndex: i + 1 };
      }
    }

    exprParts.push(code[i]);
    i++;
  }

  // Unterminated expression — return what we have
  return { content: exprParts.join(''), endIndex: code.length };
}

async function validateComponent(component: GeneratedComponent): Promise<ValidationResult> {
  try {
    // Try to transform the code with esbuild
    const result = await esbuild.transform(component.code, {
      loader: 'tsx',
      target: 'es2020',
      jsx: 'automatic',
    });

    // Check for obvious issues
    if (result.warnings.length > 0) {
      logger.warn('Component has warnings', { warnings: result.warnings });
    }

    // Basic sanity checks
    if (!component.code.includes('export')) {
      return { valid: false, error: 'Component has no exports' };
    }

    return { valid: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Component validation failed', { error: errorMessage });
    return { valid: false, error: errorMessage };
  }
}

// React globals preamble for CDN-loaded React
const REACT_GLOBALS_PREAMBLE = `
var React = window.React;
var useState = React.useState;
var useEffect = React.useEffect;
var useCallback = React.useCallback;
var useMemo = React.useMemo;
var useRef = React.useRef;
var useReducer = React.useReducer;
var useContext = React.useContext;
var createContext = React.createContext;
var ReactDOM = window.ReactDOM;
`;

export async function bundleComponents(components: GeneratedComponent[]): Promise<string> {
  if (components.length === 0) {
    logger.debug('No components to bundle');
    return '';
  }

  // Combine all components into a single module
  const combined = components.map(c => {
    let code = c.code;

    // Remove React imports since we use globals
    code = code.replace(/^import\s+(?:React|\{[^}]*\})\s+from\s+['"]react['"];?\s*$/gm, '');
    code = code.replace(/^import\s+\*\s+as\s+React\s+from\s+['"]react['"];?\s*$/gm, '');
    // Also remove any other import statements (they won't work in non-module context)
    code = code.replace(/^import\s+.*from\s+['"][^'"]+['"];?\s*$/gm, '');

    // Remove export statements - we'll expose to window manually
    code = code.replace(/^export\s+default\s+/gm, '');
    code = code.replace(/^export\s+\{\s*\w+\s*\};?\s*$/gm, '');
    code = code.replace(/^export\s+(?=const|function|class|let|var)/gm, '');

    return `// Component: ${c.name}\n${code}`;
  }).join('\n\n');

  // Add code to expose components to window
  const windowExports = components.map(c => `window.${c.name} = ${c.name};`).join('\n');

  // Add React globals preamble and window exports
  const codeWithPreamble = REACT_GLOBALS_PREAMBLE + '\n' + combined + '\n\n// Expose components globally\n' + windowExports;

  try {
    const result = await esbuild.transform(codeWithPreamble, {
      loader: 'tsx',
      target: 'es2020',
      jsx: 'transform',  // Use transform mode to use React.createElement (not imports)
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment',
      minify: true,
    });

    return result.code;
  } catch (error) {
    logger.error('Failed to bundle components', {
      error,
      componentCount: components.length,
      componentNames: components.map(c => c.name),
    });
    // Return unminified combined code as fallback instead of empty string
    return codeWithPreamble;
  }
}

export function generateMountingScript(components: GeneratedComponent[]): string {
  if (components.length === 0) {
    return '';
  }

  const mounts = components.map(c => `
    // Mount ${c.name}
    try {
      const ${c.name}Mounts = document.querySelectorAll('[data-component-type="${c.type}"]');
      ${c.name}Mounts.forEach((el, i) => {
        if (el.dataset.mounted) return; // Skip already mounted
        el.dataset.mounted = 'true';
        const root = ReactDOM.createRoot(el);
        root.render(React.createElement(${c.name}));
      });
    } catch (err) {
      console.error('Failed to mount ${c.name}:', err);
    }
  `).join('\n');

  return `
document.addEventListener('DOMContentLoaded', () => {
  ${mounts}
});
`;
}
