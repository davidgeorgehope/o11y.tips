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
    maxTokens: 4096,
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
- This applies to ALL strings, not just className`,
  });

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
  const tsxMatch = response.match(/```tsx\n([\s\S]*?)```/);
  if (tsxMatch) return sanitizeTemplateLiterals(tsxMatch[1].trim());

  const tsMatch = response.match(/```typescript\n([\s\S]*?)```/);
  if (tsMatch) return sanitizeTemplateLiterals(tsMatch[1].trim());

  const jsxMatch = response.match(/```jsx\n([\s\S]*?)```/);
  if (jsxMatch) return sanitizeTemplateLiterals(jsxMatch[1].trim());

  const genericMatch = response.match(/```\n([\s\S]*?)```/);
  if (genericMatch) return sanitizeTemplateLiterals(genericMatch[1].trim());

  // If no code blocks, check if the whole response is code
  if (response.includes('export default') || response.includes('function ') || response.includes('const ')) {
    return sanitizeTemplateLiterals(response.trim());
  }

  return null;
}

/**
 * Convert template literals to string concatenation.
 * This fixes the most common LLM mistake causing "Unterminated string literal" errors.
 */
function sanitizeTemplateLiterals(code: string): string {
  let sanitized = code;
  let iterations = 0;
  const maxIterations = 100; // Prevent infinite loops

  // Keep processing until no more template literals are found
  while (sanitized.includes('`') && iterations < maxIterations) {
    iterations++;

    // Match template literals with interpolations: `text ${expr} more`
    // This regex captures the content between backticks
    const templateMatch = sanitized.match(/`([^`]*?\$\{[^}]+\}[^`]*?)`/);

    if (templateMatch) {
      const fullMatch = templateMatch[0];
      const content = templateMatch[1];

      // Parse and convert the template literal
      const converted = convertTemplateLiteral(content);
      sanitized = sanitized.replace(fullMatch, converted);
      continue;
    }

    // Match simple template literals without interpolation: `simple text`
    const simpleMatch = sanitized.match(/`([^`$]*)`/);
    if (simpleMatch) {
      const fullMatch = simpleMatch[0];
      const content = simpleMatch[1];
      // Convert to regular string, escaping any quotes
      const escaped = content.replace(/"/g, '\\"');
      sanitized = sanitized.replace(fullMatch, '"' + escaped + '"');
      continue;
    }

    // If we have backticks but couldn't match them, break to avoid infinite loop
    break;
  }

  if (iterations > 0) {
    logger.info('Sanitized template literals', { iterations, hadBackticks: code.includes('`'), hasBackticks: sanitized.includes('`') });
  }

  return sanitized;
}

/**
 * Convert a template literal's content to string concatenation.
 * Example: "Hello ${name}!" becomes "Hello " + name + "!"
 */
function convertTemplateLiteral(content: string): string {
  const parts: string[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    const exprStart = remaining.indexOf('${');

    if (exprStart === -1) {
      // No more expressions, add remaining as string
      if (remaining.length > 0) {
        const escaped = remaining.replace(/"/g, '\\"');
        parts.push('"' + escaped + '"');
      }
      break;
    }

    // Add text before expression
    if (exprStart > 0) {
      const textBefore = remaining.substring(0, exprStart);
      const escaped = textBefore.replace(/"/g, '\\"');
      parts.push('"' + escaped + '"');
    }

    // Find matching closing brace, handling nested braces
    let braceCount = 1;
    let i = exprStart + 2;
    while (i < remaining.length && braceCount > 0) {
      if (remaining[i] === '{') braceCount++;
      if (remaining[i] === '}') braceCount--;
      i++;
    }

    if (braceCount === 0) {
      // Extract the expression (without ${ and })
      const expr = remaining.substring(exprStart + 2, i - 1);
      // Wrap in parentheses for safety
      parts.push('(' + expr + ')');
      remaining = remaining.substring(i);
    } else {
      // Malformed template, just escape and return
      const escaped = remaining.replace(/"/g, '\\"');
      parts.push('"' + escaped + '"');
      break;
    }
  }

  // Join parts with +
  if (parts.length === 0) return '""';
  if (parts.length === 1) return parts[0];
  return parts.join(' + ');
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
