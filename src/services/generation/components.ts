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

const MAX_COMPONENT_RETRIES = 3;

export async function generateComponents(
  context: GenerationContext,
  outline: ContentOutline,
  content: GeneratedContent
): Promise<GeneratedComponent[]> {
  logger.debug('Generating interactive components', {
    componentSpecs: outline.interactiveComponents.length,
  });

  const components: GeneratedComponent[] = [];

  for (const spec of outline.interactiveComponents) {
    try {
      const component = await generateComponentWithRetry(context, spec, content);
      if (component) {
        components.push(component);
      }
    } catch (error) {
      logger.error('Failed to generate component', { spec, error });
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
      }
    }

    if (alignmentResult.suggestions.length > 0) {
      logger.debug('Alignment suggestions', { suggestions: alignmentResult.suggestions });
    }
  }

  logger.debug('Components generated', { count: components.length });
  return components;
}

async function generateComponentWithRetry(
  context: GenerationContext,
  spec: ContentOutline['interactiveComponents'][0],
  content: GeneratedContent
): Promise<GeneratedComponent | null> {
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= MAX_COMPONENT_RETRIES; attempt++) {
    const component = await generateComponent(context, spec, content, lastError);
    if (!component) {
      logger.warn(`Component generation returned null on attempt ${attempt}`, { type: spec.type });
      continue;
    }

    const validation = await validateComponent(component);
    if (validation.valid) {
      logger.info(`Component generated successfully on attempt ${attempt}`, { type: spec.type });
      return component;
    }

    lastError = validation.error || 'Unknown validation error';
    logger.warn(`Component validation failed on attempt ${attempt}`, {
      type: spec.type,
      error: lastError,
      attempt,
      maxRetries: MAX_COMPONENT_RETRIES
    });
  }

  logger.error(`Component generation failed after ${MAX_COMPONENT_RETRIES} attempts`, {
    type: spec.type,
    lastError
  });
  return null;
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
    prompt += `

PREVIOUS ATTEMPT FAILED with this error:
${previousError}

The most common cause is using template literals (backticks). Search your code for any \` character and replace with string concatenation using + and regular quotes.

Fix checklist:
1. Replace ALL template literals with string concatenation
2. Check for missing imports
3. Verify TypeScript types
4. Ensure valid JSX structure`;
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
- SVG or canvas visualization
- Interactive hover states
- Labels and annotations
- Responsive sizing`,

    calculator: `
EXAMPLE STRUCTURE:
- Input fields for parameters
- Calculate button
- Results display
- Clear explanation of formula`,

    'comparison-table': `
EXAMPLE STRUCTURE:
- Feature comparison grid
- Sortable/filterable
- Highlighted recommendations
- Expandable details`,
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
  if (tsxMatch) return tsxMatch[1].trim();

  const tsMatch = response.match(/```typescript\n([\s\S]*?)```/);
  if (tsMatch) return tsMatch[1].trim();

  const jsxMatch = response.match(/```jsx\n([\s\S]*?)```/);
  if (jsxMatch) return jsxMatch[1].trim();

  const genericMatch = response.match(/```\n([\s\S]*?)```/);
  if (genericMatch) return genericMatch[1].trim();

  // If no code blocks, check if the whole response is code
  if (response.includes('export default') || response.includes('function ') || response.includes('const ')) {
    return response.trim();
  }

  return null;
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
