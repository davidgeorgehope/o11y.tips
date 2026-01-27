import { generateWithClaude } from '../ai/clients.js';
import { createLogger } from '../../utils/logger.js';
import type { GeneratedComponent, ContentOutline } from '../generation/types.js';

const logger = createLogger('quality:alignment');

export interface AlignmentIssue {
  componentId: string;
  type: 'layout' | 'styling' | 'structure' | 'accessibility';
  severity: 'warning' | 'error';
  description: string;
  suggestion: string;
}

export interface AlignmentValidationResult {
  isValid: boolean;
  issues: AlignmentIssue[];
  suggestions: string[];
}

export async function validateComponentAlignment(
  components: GeneratedComponent[],
  outline: ContentOutline
): Promise<AlignmentValidationResult> {
  if (components.length === 0) {
    return { isValid: true, issues: [], suggestions: [] };
  }

  logger.debug('Validating component alignment', { componentCount: components.length });

  const allIssues: AlignmentIssue[] = [];
  const allSuggestions: string[] = [];

  for (const component of components) {
    try {
      const result = await validateSingleComponent(component, outline);
      allIssues.push(...result.issues);
      allSuggestions.push(...result.suggestions);
    } catch (error) {
      logger.error('Failed to validate component alignment', { componentId: component.id, error });
    }
  }

  const hasErrors = allIssues.some(issue => issue.severity === 'error');

  logger.debug('Alignment validation complete', {
    isValid: !hasErrors,
    issueCount: allIssues.length,
    errorCount: allIssues.filter(i => i.severity === 'error').length,
  });

  return {
    isValid: !hasErrors,
    issues: allIssues,
    suggestions: allSuggestions,
  };
}

async function validateSingleComponent(
  component: GeneratedComponent,
  outline: ContentOutline
): Promise<{ issues: AlignmentIssue[]; suggestions: string[] }> {
  const prompt = buildValidationPrompt(component, outline);

  const response = await generateWithClaude(prompt, {
    maxTokens: 2048,
    temperature: 0.2,
    systemPrompt: `You are an expert frontend developer reviewing React components for visual alignment and layout issues.
Analyze the provided code for CSS/Tailwind alignment problems that would cause visual inconsistencies.
Focus on practical issues that affect user experience.
Be concise and actionable in your feedback.`,
  });

  return parseValidationResponse(response.content, component.id);
}

function buildValidationPrompt(component: GeneratedComponent, outline: ContentOutline): string {
  return `Review this React component for alignment and layout issues.

COMPONENT INFO:
Name: ${component.name}
Type: ${component.type}
Article Context: ${outline.title}

CODE:
\`\`\`tsx
${component.code}
\`\`\`

Check for these specific issues:

1. LAYOUT ALIGNMENT
   - Flexbox/grid centering (items-center, justify-center, etc.)
   - Text alignment consistency
   - Proper use of mx-auto for horizontal centering

2. RESPONSIVE DESIGN
   - Mobile-first approach with proper breakpoints (sm:, md:, lg:)
   - Container widths that work across screen sizes
   - No fixed widths that break on mobile

3. VISUAL CONSISTENCY
   - Consistent spacing (padding/margin patterns)
   - Proper visual hierarchy
   - Balanced whitespace

4. STRUCTURAL ISSUES
   - Nested flex/grid containers that might conflict
   - Z-index layering problems
   - Overflow handling

For each issue found, respond in this format:

ISSUE:
Type: [layout|styling|structure|accessibility]
Severity: [error|warning]
Description: [what's wrong]
Suggestion: [how to fix it with specific code change]

If no issues found, respond with:
NO_ISSUES

End with any general suggestions (even if no issues):

SUGGESTIONS:
- [optional improvements]`;
}

function parseValidationResponse(
  response: string,
  componentId: string
): { issues: AlignmentIssue[]; suggestions: string[] } {
  const issues: AlignmentIssue[] = [];
  const suggestions: string[] = [];

  // Check for no issues
  if (response.includes('NO_ISSUES')) {
    // Still extract suggestions if present
    const suggestionsMatch = response.match(/SUGGESTIONS:\s*([\s\S]*?)$/);
    if (suggestionsMatch) {
      const suggestionLines = suggestionsMatch[1].split('\n')
        .map(line => line.replace(/^-\s*/, '').trim())
        .filter(line => line.length > 0);
      suggestions.push(...suggestionLines);
    }
    return { issues, suggestions };
  }

  // Parse issues
  const issueRegex = /ISSUE:\s*Type:\s*(layout|styling|structure|accessibility)\s*Severity:\s*(error|warning)\s*Description:\s*(.+?)\s*Suggestion:\s*(.+?)(?=ISSUE:|SUGGESTIONS:|$)/gis;

  let match;
  while ((match = issueRegex.exec(response)) !== null) {
    const [, type, severity, description, suggestion] = match;
    issues.push({
      componentId,
      type: type.toLowerCase() as AlignmentIssue['type'],
      severity: severity.toLowerCase() as AlignmentIssue['severity'],
      description: description.trim(),
      suggestion: suggestion.trim(),
    });
  }

  // Extract suggestions section
  const suggestionsMatch = response.match(/SUGGESTIONS:\s*([\s\S]*?)$/);
  if (suggestionsMatch) {
    const suggestionLines = suggestionsMatch[1].split('\n')
      .map(line => line.replace(/^-\s*/, '').trim())
      .filter(line => line.length > 0);
    suggestions.push(...suggestionLines);
  }

  return { issues, suggestions };
}

export async function regenerateWithAlignmentHints(
  component: GeneratedComponent,
  alignmentSuggestion: string,
  context: { title: string; description: string }
): Promise<GeneratedComponent> {
  logger.info('Regenerating component with alignment fix', {
    componentId: component.id,
    componentName: component.name,
  });

  const prompt = `Fix the alignment issues in this React component.

ORIGINAL CODE:
\`\`\`tsx
${component.code}
\`\`\`

ALIGNMENT ISSUE TO FIX:
${alignmentSuggestion}

CONTEXT:
This component is for an article titled: ${context.title}
Description: ${context.description}

Requirements:
1. Fix the specific alignment issue mentioned above
2. Maintain all existing functionality
3. Use Tailwind CSS classes for styling
4. Ensure proper responsive design

CRITICAL - NO TEMPLATE LITERALS:
Use string concatenation instead of backticks for dynamic strings.
WRONG: className={\`px-4 \${active ? "bg-blue-500" : "bg-gray-500"}\`}
CORRECT: className={"px-4 " + (active ? "bg-blue-500" : "bg-gray-500")}

Output ONLY the fixed component code wrapped in \`\`\`tsx code blocks.`;

  const response = await generateWithClaude(prompt, {
    maxTokens: 4096,
    temperature: 0.2,
    systemPrompt: `You are an expert React developer fixing alignment issues in components.
Make minimal changes to fix the specific issue while preserving functionality.
Never use template literals (backticks) - always use string concatenation.`,
  });

  // Extract code from response
  const code = extractCode(response.content);
  if (!code) {
    logger.warn('Failed to extract fixed code, returning original', { componentId: component.id });
    return component;
  }

  return {
    ...component,
    code,
  };
}

function extractCode(response: string): string | null {
  const tsxMatch = response.match(/```tsx\n([\s\S]*?)```/);
  if (tsxMatch) return tsxMatch[1].trim();

  const tsMatch = response.match(/```typescript\n([\s\S]*?)```/);
  if (tsMatch) return tsMatch[1].trim();

  const jsxMatch = response.match(/```jsx\n([\s\S]*?)```/);
  if (jsxMatch) return jsxMatch[1].trim();

  const genericMatch = response.match(/```\n([\s\S]*?)```/);
  if (genericMatch) return genericMatch[1].trim();

  return null;
}
